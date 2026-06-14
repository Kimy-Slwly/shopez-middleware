@echo off
title ShopEZ Service Runner
echo ==========================================================
echo           ShopEZ Malaysia Service Orchestrator
echo ==========================================================
echo.
echo This script will launch the 4 Node.js microservices in separate
echo terminal windows. Ensure Docker Desktop is running.
echo.
echo Checking if RabbitMQ container is running...
docker ps | findstr rabbitmq > nul
if %errorlevel% equ 0 (
    echo [OK] RabbitMQ Docker container is running.
) else (
    echo [WARNING] RabbitMQ container does not seem to be running!
    echo Attempting to start rabbitmq container...
    docker start rabbitmq > nul 2>&1
    if %errorlevel% neq 0 (
        echo Attempting to run a new rabbitmq container...
        docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
    )
)
echo.
echo ----------------------------------------------------------
echo Launching services...
echo.

echo [1/4] Starting API Gateway (Port 8000)...
start "ShopEZ - API Gateway" cmd /k "node api_gateway/app.js"
timeout /t 1 /nobreak > nul

echo [2/4] Starting Order Service (Consumer)...
start "ShopEZ - Order Service" cmd /k "node order_service/consumer.js"
timeout /t 2 /nobreak > nul

echo [3/4] Starting Inventory Service (Consumer)...
start "ShopEZ - Inventory Service" cmd /k "node inventory_service/consumer.js"
timeout /t 1 /nobreak > nul

echo [4/4] Starting Payment Service (Consumer)...
start "ShopEZ - Payment Service" cmd /k "node payment_service/consumer.js"

echo.
echo ==========================================================
echo SUCCESS: All microservices have been initialized!
echo ==========================================================
echo.
echo Press any key to exit this orchestrator window...
pause > nul
