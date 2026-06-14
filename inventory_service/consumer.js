const amqp = require('amqplib');
const db = require('../db');

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'localhost';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672;
const EXCHANGE_NAME = 'order_exchange';
const QUEUE_NAME = 'inventory_queue';

async function main() {
    console.log(" [Inventory Service] Starting consumer...");
    const rabbitUrl = `amqp://guest:guest@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
    
    let connection;
    let retries = 5;
    while (retries > 0) {
        try {
            connection = await amqp.connect(rabbitUrl);
            break;
        } catch (error) {
            console.error(` [Inventory Service] Connection failed. Retries left: ${retries - 1}`);
            retries -= 1;
            await new Promise(res => setTimeout(res, 5000));
        }
    }
    
    if (!connection) process.exit(1);
    
    const channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, '');
    
    console.log(` [Inventory Service] Waiting for orders in queue '${QUEUE_NAME}'. To exit press CTRL+C`);
    
    channel.consume(QUEUE_NAME, async (msg) => {
        if (msg !== null) {
            try {
                const orderData = JSON.parse(msg.content.toString());
                const orderId = orderData.order_id;
                const items = orderData.items || [];
                
                console.log(`\n [Inventory Service] Received order update for Order ID: ${orderId}`);
                console.log(" [Inventory Service] Simulating inventory checks and stock decrement (2s delay)...");
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                items.forEach(item => {
                    db.run('INSERT INTO inventory_logs (order_id, product_id, quantity, status) VALUES (?, ?, ?, ?)',
                        [orderId, item.product_id, item.quantity, 'DEDUCTED'],
                        (err) => {
                            if (err) console.error(" [Inventory Service] DB Error:", err.message);
                            else console.log(` [Inventory Service] Logged inventory deduction for ${item.product_id} to DB`);
                        }
                    );
                });

                console.log(` [Inventory Service] Stock successfully updated for Order ID: ${orderId}\n`);
            } catch (error) {
                console.error(` [Inventory Service] Error processing message: ${error.message}`);
            }
        }
    }, { noAck: true });
}

main().catch(console.error);
