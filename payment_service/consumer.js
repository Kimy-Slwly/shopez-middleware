const amqp = require('amqplib');
const db = require('../db');

const RABBITMQ_URL = process.env.RABBITMQ_URL || `amqp://guest:guest@${process.env.RABBITMQ_HOST || 'localhost'}:${process.env.RABBITMQ_PORT || 5672}`;
const EXCHANGE_NAME = 'order_exchange';
const QUEUE_NAME = 'payment_queue';

async function main() {
    console.log(" [Payment Service] Starting consumer...");
    const rabbitUrl = RABBITMQ_URL;
    
    let connection;
    let retries = 5;
    while (retries > 0) {
        try {
            connection = await amqp.connect(rabbitUrl);
            break;
        } catch (error) {
            console.error(` [Payment Service] Connection failed. Retries left: ${retries - 1}`);
            retries -= 1;
            await new Promise(res => setTimeout(res, 5000));
        }
    }
    
    if (!connection) process.exit(1);
    
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, '');
    
    console.log(` [Payment Service] Waiting for orders in queue '${QUEUE_NAME}'. To exit press CTRL+C`);
    
    channel.consume(QUEUE_NAME, async (msg) => {
        if (msg !== null) {
            try {
                const orderData = JSON.parse(msg.content.toString());
                const orderId = orderData.order_id;
                const totalAmount = orderData.total_amount || 0.0;
                
                console.log(`\n [Payment Service] Received order for payment processing: ${orderId}`);
                console.log(" [Payment Service] Contacting payment gateway and processing transaction (3s delay)...");
                
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                db.run('INSERT INTO payments (order_id, amount, status) VALUES (?, ?, ?)',
                    [orderId, parseFloat(totalAmount), 'SUCCESS'],
                    (err) => {
                        if (err) console.error(" [Payment Service] DB Error:", err.message);
                        else {
                            console.log(` [Payment Service] Logged payment for ${orderId} to DB`);
                            db.run('UPDATE orders SET status = ? WHERE order_id = ?', ['COMPLETED', orderId]);
                        }
                    }
                );

                console.log(` [Payment Service] Transaction completed successfully for Order ID: ${orderId}\n`);
            } catch (error) {
                console.error(` [Payment Service] Error processing message: ${error.message}`);
            }
        }
    }, { noAck: true });
}

main().catch(console.error);
