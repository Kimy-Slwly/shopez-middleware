const express = require('express');
const cors = require('cors');
const amqp = require('amqplib');
const crypto = require('crypto');
const db = require('../db');

const app = express();
app.use(cors());
app.use(express.json());

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
        // publish to fanout exchange, routing key is ignored
        const published = channel.publish(EXCHANGE_NAME, '', Buffer.from(message), {
            persistent: true
        });
        
        console.log(` [Order Service] Sent order event: ${orderData.order_id}`);
        
        // Let the buffer flush before closing the connection
        setTimeout(() => {
            connection.close();
        }, 500);
        
        return published;
    } catch (error) {
        console.error(` [Order Service] Failed to publish event: ${error.message}`);
        if (connection) {
            try { await connection.close(); } catch(e) {}
        }
        return false;
    }
}

app.post('/place_order', async (req, res) => {
    try {
        const data = req.body;
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ error: "Invalid payload. JSON body is required." });
        }

        const customerId = data.customer_id;
        const items = data.items || [];
        let totalAmount = data.total_amount;

        if (!customerId) return res.status(400).json({ error: "Missing 'customer_id' field." });
        if (!items.length) return res.status(400).json({ error: "Missing or empty 'items' list." });

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

        // Save order to SQLite Database
        db.run('INSERT INTO orders (order_id, customer_id, total_amount, status) VALUES (?, ?, ?, ?)', 
            [orderId, customerId, parseFloat(totalAmount), "PENDING"], 
            (err) => {
                if (err) console.error(" [Order Service] DB Error:", err.message);
                else console.log(` [Order Service] Saved order ${orderId} to DB`);
            }
        );

        if (published) {
            return res.status(202).json({
                status: "success",
                message: "Order placed successfully. Processing in background via middleware.",
                data: orderPayload
            });
        } else {
            return res.status(503).json({
                status: "failure",
                message: "Failed to connect to message broker. Please ensure RabbitMQ is running.",
                data: orderPayload
            });
        }
    } catch (error) {
        return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
});

app.post('/place_order_p2p', async (req, res) => {
    try {
        const data = req.body;
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ error: "Invalid payload. JSON body is required." });
        }

        const customerId = data.customer_id;
        const items = data.items || [];
        let totalAmount = data.total_amount;
        if (totalAmount === undefined || totalAmount === null) {
            totalAmount = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
        }

        const orderId = data.order_id || `ORD-P2P-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        console.log(`\n [Point-to-Point API] Received order: ${orderId}`);
        
        // Save initial order status
        db.run('INSERT INTO orders (order_id, customer_id, total_amount, status) VALUES (?, ?, ?, ?)', 
            [orderId, customerId, parseFloat(totalAmount), "PENDING"], 
            (err) => { if (err) console.error(" [Order Service] DB Error:", err.message); }
        );

        console.log(` [Point-to-Point API] Calling Inventory Service (Sync)...`);
        const invRes = await fetch('http://localhost:5001/api/inventory/deduct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, items })
        });
        if (!invRes.ok) throw new Error("Inventory Service failed");
        console.log(` [Point-to-Point API] Inventory updated.`);
        
        console.log(` [Point-to-Point API] Calling Payment Service (Sync)...`);
        const payRes = await fetch('http://localhost:5002/api/payment/charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, customerId, totalAmount })
        });
        if (!payRes.ok) throw new Error("Payment Service failed");
        console.log(` [Point-to-Point API] Payment processed.`);
        console.log(` [Point-to-Point API] Finished processing Order ID: ${orderId}\n`);

        const orderPayload = {
            order_id: orderId,
            customer_id: customerId,
            items: items,
            total_amount: parseFloat(totalAmount),
            timestamp: new Date().toISOString(),
            status: "COMPLETED"
        };
        
        // Update order status
        db.run('UPDATE orders SET status = ? WHERE order_id = ?', ['COMPLETED', orderId]);

        return res.status(200).json({
            status: "success",
            message: "Order placed sequentially (Point-to-Point).",
            data: orderPayload
        });
    } catch (error) {
        return res.status(500).json({ error: `An error occurred: ${error.message}` });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: "healthy", service: "order_service" });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`Starting Order Service Express App on port ${port}...`);
});
