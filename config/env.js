require("dotenv").config();

const timeZone = process.env.TZ || "America/Lima";
process.env.TZ = timeZone;

const required = [
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "SESSION_SECRET",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length)
  throw new Error(`Variables de entorno faltantes: ${missing.join(", ")}`);

module.exports = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  storeName: process.env.STORE_NAME || "Don Pepe WMS",
  taxRate: Number(process.env.TAX_RATE || 0.18),
  timeZone,
  sessionSecret: process.env.SESSION_SECRET,
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  mail: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.MAIL_FROM || "Don Pepe WMS <no-reply@donpepe.local>",
  },
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true,
    timezone: "-05:00",
  },
});
