import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);

buildApp()
  .then((app) =>
    app.listen({ port, host: "0.0.0.0" }).then(() => {
      app.log.info(`bpmn-analyst server listening on http://localhost:${port}`);
    }),
  )
  .catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
