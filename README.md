# ShopEZ Malaysia: Asynchronous Middleware Integration Prototype (Node.js)

This repository contains the complete implementation of the **ShopEZ Malaysia Asynchronous Middleware Integration Prototype**. 

The prototype demonstrates a decoupled, asynchronous, microservices-based e-commerce order processing pipeline using **RabbitMQ** as the message-oriented middleware and **Node.js** (Express + amqplib) for service development.

---

## 🚀 Architecture Overview

In a typical monolithic e-commerce application, when a customer places an order, the system blocks the client while performing stock verification and payment processing sequentially. This leads to slow response times and tight coupling.

This prototype demonstrates how **middleware integration** decouples these operations:
1. **Decoupling**: The Order Service is responsible *only* for receiving and logging the order, then immediately notifying the middleware.
2. **Asynchronous Execution**: Other operations (inventory update and billing) are processed in the background by separate worker services without blocking the buyer's checkout process.
3. **High Availability & Scale**: If the payment service experiences high traffic or goes offline, messages accumulate safely in RabbitMQ without dropping orders.

### System Diagram

```
                 [ User Browser / Test Dashboard ]
                                |
                         (POST /place_order)
                                v
                       [ Order Service ]
                        (Express API)
                                |
                        (Publish Event)
                                v
               [ RabbitMQ Fanout Exchange ] (order_exchange)
                       /               \
              (Broadcast)             (Broadcast)
                     v                     v
              [ inventory_queue ]    [ payment_queue ]
                     |                     |
                     v                     v
            [ Inventory Service ]  [ Payment Service ]
                (Background)          (Background)
```

---

## 🛠️ Components & Technologies

1. **Order Service** (`order_service/app.js`):
   - **Role**: REST API entrypoint & Producer.
   - **Port**: `5000`
   - **Framework**: Express.js (Node.js).
   - **Behavior**: Exposes `/place_order`, validates input, publishes a JSON event payload to RabbitMQ's fanout exchange, and immediately returns HTTP status `202 (Accepted)`.

2. **Inventory Service** (`inventory_service/consumer.js`):
   - **Role**: Asynchronous Worker / Consumer.
   - **Queue**: `inventory_queue` (bound to `order_exchange`).
   - **Behavior**: Simulates stock checking and decrement logic with a 2-second processing delay.

3. **Payment Service** (`payment_service/consumer.js`):
   - **Role**: Asynchronous Worker / Consumer.
   - **Queue**: `payment_queue` (bound to `order_exchange`).
   - **Behavior**: Simulates contact with an external payment gateway and billing with a 3-second processing delay.

4. **RabbitMQ Broker** (Dockerized):
   - **Role**: Message-oriented middleware.
   - **Ports**: `5672` (AMQP Broker) and `15672` (Management Console Dashboard).

5. **Sandbox Dashboard** (`index.html`):
   - **Role**: Modern, interactive web UI to test and visualize the asynchronous workflow.

---

## 🏁 Step-by-Step Execution Guide

To run and observe the entire system in action, follow these steps. You will need to open **four separate terminals** (e.g., PowerShell on Windows or Bash on macOS/Linux).

### Prerequisites
Make sure Node.js (v18+) and Docker Desktop are installed and running.

---

### Step 1: Start RabbitMQ
Run this command in your terminal to start RabbitMQ inside a Docker container:
```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```
*Note: The management dashboard is accessible at `http://localhost:15672` (Username: `guest`, Password: `guest`).*

---

### Step 2: Launch the Order Service
Navigate to the root directory and start the Express web server:
```bash
node order_service/app.js
```
*The Express application will start listening on `http://localhost:5000`.*

---

### Step 3: Launch the Inventory Service
Start the inventory background worker:
```bash
node inventory_service/consumer.js
```

---

### Step 4: Launch the Payment Service
Start the payment billing worker:
```bash
node payment_service/consumer.js
```

---

## 🧪 Testing the Prototype

### Method A: Interactive Visual Dashboard (Recommended)
1. Double-click or open [index.html](file:///C:/backup/UTHM/Sem%202/shopez-middleware/index.html) in your web browser.
2. Verify the indicator in the top right shows **"Order Service online"**.
3. Select quantities for items in the **Order Sandbox** card.
4. Click **"Place Order Asynchronously"**.
5. **Observe the magic**:
   - The UI immediately logs the success response from the Express API.
   - Watch the **Middleware Route Simulation** animate the message flow.
   - Look at the console logs in the terminal windows for `inventory_service` and `payment_service` to see them process the order in real-time.

### Method B: Testing via cURL / Postman
Send a `POST` request to `http://localhost:5000/place_order` with the following JSON body:
```json
{
  "customer_id": "CUST-MY-8819",
  "items": [
    {
      "product_id": "PROD-001",
      "quantity": 2,
      "price": 149.00
    }
  ],
  "total_amount": 298.00
}
```

#### Expected Terminal Logs
**Order Service Terminal:**
```text
Starting Order Service Express App on port 5000...
 [Order Service] Sent order event: ORD-F5EA2C31
```

**Inventory Service Terminal:**
```text
 [Inventory Service] Starting consumer...
 [Inventory Service] Waiting for orders in queue 'inventory_queue'. To exit press CTRL+C

 [Inventory Service] Received order update for Order ID: ORD-F5EA2C31
 [Inventory Service] Items to check and update stock:
   - Product: PROD-001, Quantity requested: 2
 [Inventory Service] Simulating inventory checks and stock decrement (2s delay)...
 [Inventory Service] Stock successfully updated for Order ID: ORD-F5EA2C31
 [Inventory Service] Finished processing Order ID: ORD-F5EA2C31
```

**Payment Service Terminal:**
```text
 [Payment Service] Starting consumer...
 [Payment Service] Waiting for orders in queue 'payment_queue'. To exit press CTRL+C

 [Payment Service] Received order for payment processing: ORD-F5EA2C31
 [Payment Service] Billing customer: CUST-MY-8819
 [Payment Service] Amount to charge: RM 298.00
 [Payment Service] Contacting payment gateway and processing transaction (3s delay)...
 [Payment Service] Transaction completed successfully for Order ID: ORD-F5EA2C31
 [Payment Service] Invoice generated & receipt sent to customer CUST-MY-8819
 [Payment Service] Finished processing Order ID: ORD-F5EA2C31
```

---

## 📈 Performance & decoupling proof
- **Immediate Response Time**: The HTTP response from the Order Service returns in milliseconds since it does not wait for database locks or payment validation.
- **Microservices decouping**: If the Payment Service is shut down, you can still place orders. The message is stored in RabbitMQ's `payment_queue`. Once you restart the Payment Service, it immediately consumes the accumulated orders and completes the transactions.
