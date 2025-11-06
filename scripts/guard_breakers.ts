#!/usr/bin/env -S npx tsx
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();
const path = "runtime/guard_breakers.json";
type Guard = { pauseBuys: string[], resumeSkewPct: number };
const g: Guard = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path,"utf8")) : { pauseBuys: [], resumeSkewPct: 15 };
if (!g.pauseBuys.includes("BOME")) g.pauseBuys.push("BOME");
fs.writeFileSync(path, JSON.stringify(g, null, 2));
console.log("✅ Guard updated:", g);
