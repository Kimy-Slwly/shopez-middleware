const amqp = require('amqplib');
const db = require('../db');

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'localhost';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672;
const EXCHANGE_NAME = 'order_exchange';
const QUEUE_NAME = 'order_queue';

async function main() {
    console.log(" [Order Service] Starting consumer...");
    const rabbitUrl = `amqp://guest:guest@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
    
    let connection;
    let retries = 5;
    while (retries > 0) {
        try {
            connection = await amqp.connect(rabbitUrl);
            break;
        } catch (error) {
            console.error(` [Order Service] Connection failed. Retries left: ${retries - 1}`);
            retries -= 1;
            await new Promise(res => setTimeout(res, 5000));
        }
    }
    
    if (!connection) process.exit(1);
    
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, '');
    
    console.log(` [Order Service] Waiting for orders in queue '${QUEUE_NAME}'. To exit press CTRL+C`);
    
    channel.consume(QUEUE_NAME, async (msg) => {
        if (msg !== null) {
            try {
                const orderData = JSON.parse(msg.content.toString());
                const orderId = orderData.order_id;
                
                console.log(`\n [Order Service] Received order: ${orderId}`);
                
                db.run('INSERT INTO orders (order_id, customer_id, total_amount, status) VALUES (?, ?, ?, ?)', 
                    [orderId, orderData.customer_id, parseFloat(orderData.total_amount), "PENDING"], 
                    (err) => {
                        if (err) console.error(" [Order Service] DB Error:", err.message);
                        else console.log(` [Order Service] Saved order ${orderId} to DB`);
                    }
                );
            } catch (error) {
                console.error(` [Order Service] Error processing message: ${error.message}`);
            }
        }
    }, { noAck: true });
}

main().catch(console.error);
