const express = require('express');
const cors = require('cors');
const amqp = require('amqplib');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from the root directory
app.use(express.static(path.join(__dirname, '../')));

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'localhost';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672;
const EXCHANGE_NAME = 'order_exchange';

async function publishOrderEvent(orderData) {
    let connection;
    try {
        const rabbitUrl = `amqp://guest:guest@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
        connection = await amqp.connect(rabbitUrl);
        const channel = await connection.createChannel();
        
        await channel.assertExchange(EXCHANGE_NAME, 'fanout', { durable: true });
        
        const message = JSON.stringify(orderData);
        const published = channel.publish(EXCHANGE_NAME, '', Buffer.from(message), { persistent: true });
        
        console.log(` [API Gateway] Sent order event: ${orderData.order_id}`);
        
        setTimeout(() => { connection.close(); }, 500);
        return published;
    } catch (error) {
        console.error(` [API Gateway] Failed to publish event: ${error.message}`);
        if (connection) { try { await connection.close(); } catch(e) {} }
        return false;
    }
}

app.post('/api/orders/place_order', async (req, res) => {
    try {
        const data = req.body;
        if (!data || Object.keys(data).length === 0) return res.status(400).json({ error: "Invalid payload." });
        
        const customerId = data.customer_id;
        const items = data.items || [];
        let totalAmount = data.total_amount;
        if (totalAmount === undefined || totalAmount === null) {
            totalAmount = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
        }

        const orderId = data.order_id || `ORD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        const orderPayload = {
            order_id: orderId,
            customer_id: customerId,
            items: items,
            total_amount: parseFloat(totalAmount),
            timestamp: new Date().toISOString(),
            status: "PENDING"
        };

        const published = await publishOrderEvent(orderPayload);
        if (published) {
            return res.status(202).json({
                status: "success",
                message: "Order placed successfully. Processing in background via middleware.",
                data: orderPayload
            });
        } else {
            return res.status(503).json({ error: "Failed to connect to message broker." });
        }
    } catch (error) {
        return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
});

const port = process.env.PORT || 8000;
app.listen(port, () => {
    console.log(`Starting API Gateway on port ${port}...`);
});
