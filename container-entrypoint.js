#!/usr/bin/env node

/**
 * Container entrypoint that runs both the cron job and health server
 * This allows the container to serve health checks while running the cron job
 */

const { spawn } = require('child_process');
const logger = require('./src/logger');

class ContainerManager {
    constructor() {
        this.cronProcess = null;
        this.healthProcess = null;
        this.isShuttingDown = false;
    }

    async start() {
        logger.info('🚀 Starting containerized Shopify cron application');
        
        try {
            // Start health server first
            await this.startHealthServer();
            
            // Start cron job
            await this.startCronJob();
            
            // Handle graceful shutdown
            this.setupSignalHandlers();
            
            logger.info('✅ Container started successfully - both processes running');
            
        } catch (error) {
            logger.error('❌ Failed to start container:', error.message);
            process.exit(1);
        }
    }

    startHealthServer() {
        return new Promise((resolve, reject) => {
            logger.info('Starting health server...');
            
            this.healthProcess = spawn('node', ['health-server.js'], {
                stdio: ['inherit', 'inherit', 'inherit'],
                env: { ...process.env }
            });

            this.healthProcess.on('error', (error) => {
                logger.error('Health server error:', error.message);
                if (!this.isShuttingDown) {
                    reject(error);
                }
            });

            this.healthProcess.on('exit', (code, signal) => {
                if (!this.isShuttingDown) {
                    logger.error(`Health server exited with code ${code}, signal ${signal}`);
                    process.exit(1);
                }
            });

            // Give the health server a moment to start
            setTimeout(() => {
                logger.info('✅ Health server started');
                resolve();
            }, 2000);
        });
    }

    startCronJob() {
        return new Promise((resolve) => {
            logger.info('Starting cron job...');
            
            this.cronProcess = spawn('node', ['src/index.js'], {
                stdio: ['inherit', 'inherit', 'inherit'],
                env: { ...process.env }
            });

            this.cronProcess.on('error', (error) => {
                logger.error('Cron job error:', error.message);
                if (!this.isShuttingDown) {
                    // Don't exit on cron errors, keep health server running
                    logger.warn('Cron job failed, but keeping container alive for health checks');
                }
            });

            this.cronProcess.on('exit', (code, signal) => {
                if (!this.isShuttingDown) {
                    logger.warn(`Cron job exited with code ${code}, signal ${signal}`);
                    // Restart cron job after a delay
                    setTimeout(() => {
                        if (!this.isShuttingDown) {
                            logger.info('Restarting cron job...');
                            this.startCronJob();
                        }
                    }, 5000);
                }
            });

            logger.info('✅ Cron job started');
            resolve();
        });
    }

    setupSignalHandlers() {
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
        
        signals.forEach(signal => {
            process.on(signal, () => {
                logger.info(`Received ${signal}, shutting down gracefully...`);
                this.shutdown();
            });
        });

        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
            this.shutdown();
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled promise rejection:', reason);
            this.shutdown();
        });
    }

    shutdown() {
        if (this.isShuttingDown) {
            return;
        }
        
        this.isShuttingDown = true;
        logger.info('🛑 Shutting down container...');

        const shutdownPromises = [];

        if (this.cronProcess) {
            shutdownPromises.push(new Promise((resolve) => {
                this.cronProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (!this.cronProcess.killed) {
                        this.cronProcess.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);
            }));
        }

        if (this.healthProcess) {
            shutdownPromises.push(new Promise((resolve) => {
                this.healthProcess.kill('SIGTERM');
                setTimeout(() => {
                    if (!this.healthProcess.killed) {
                        this.healthProcess.kill('SIGKILL');
                    }
                    resolve();
                }, 5000);
            }));
        }

        Promise.all(shutdownPromises).then(() => {
            logger.info('✅ Container shutdown complete');
            process.exit(0);
        });
    }
}

// Start the container manager
const containerManager = new ContainerManager();
containerManager.start().catch((error) => {
    logger.error('Failed to start container:', error);
    process.exit(1);
});
