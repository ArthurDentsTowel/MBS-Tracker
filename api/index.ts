import express from "express";
import { registerRoutes } from "../server/routes";
import { createServer } from "http";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const httpServer = createServer(app);
const routesReady = registerRoutes(httpServer, app);

export default async function handler(req: any, res: any) {
  await routesReady;
  return app(req, res);
}
