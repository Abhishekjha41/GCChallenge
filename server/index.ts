// server/index.ts
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import serverless from "serverless-http";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Enable CORS for development
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Middleware to log responses for API routes
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;
  const originalResJson = res.json.bind(res);
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson, ...args);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });
  next();
});

// Create an initialization promise to ensure that all async setup completes before handling any request.
let isInitialized = false;
const initializationPromise = (async () => {
  try {
    console.log("Before registering routes");
    await registerRoutes(app);
    console.log("After registering routes");

    // Optionally, log the registered routes for debugging.
    const registeredRoutes = app._router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);
    console.log("Registered routes:", registeredRoutes);

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
      log(`Error: ${message} (status: ${status})`);
    });

    // In development, set up Vite; in production, serve static files.
    if (app.get("env") === "development") {
      // If running locally, create an HTTP server and set up Vite middleware.
      const server = createServer(app);
      await setupVite(app, server);
      // If not on Vercel, start listening.
      if (!process.env.VERCEL) {
        const port = 5000;
        const host = "localhost";
        server.listen(port, host, () => {
          log(`Server running at http://${host}:${port}`);
        });
      }
    } else {
      serveStatic(app);
    }

    isInitialized = true;
    console.log("Initialization complete");
  } catch (error) {
    console.error("Initialization failed:", error);
    // Rethrow so that waiting middleware can catch it.
    throw error;
  }
})();

// Middleware that waits for the initialization promise to resolve before handling any request.
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!isInitialized) {
    try {
      await initializationPromise;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// For Vercel deployments, export the serverless handler.
// Vercel will use this exported function to handle requests.
export default process.env.VERCEL ? serverless(app) : app;
