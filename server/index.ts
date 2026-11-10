import { createUnoServer } from "./app.js";

const app = createUnoServer();
const url = await app.listen(
  Number(process.env.PORT || 10889),
  process.env.HOST || "0.0.0.0",
);
console.log(`UNO online service listening at ${url}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
