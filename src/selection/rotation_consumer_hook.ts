import { loadActivePairs } from "./active_pairs_consumer.js";

type PairsCallback = (pairs: string[]) => void;

export function installRotationConsumer(callback: PairsCallback): void {
  const filePath = process.env.ACTIVE_PAIRS_FILE_PATH || "runtime/active_pairs.json";
  const pollSec = Number(process.env.ACTIVE_PAIRS_POLL_SEC || 60);
  const staleSec = Number(process.env.ACTIVE_PAIRS_MAX_AGE_SEC || 900);
  const minCount = Number(process.env.ACTIVE_PAIRS_MIN || 1);
  const maxCount = Number(process.env.ACTIVE_PAIRS_MAX || 10);
  
  const allowlistStr = process.env.ACTIVE_PAIRS_ALLOWLIST;
  const allowlist = allowlistStr
    ? new Set(allowlistStr.split(",").map((s) => s.trim().toUpperCase()))
    : undefined;

  const opts = { filePath, staleSec, minCount, maxCount, allowlist };

  function poll() {
    const result = loadActivePairs(opts);
    if (result.ok) {
      console.log(
        `rotation_evt=apply source=poll pairs=${result.pairs.join(",")} updated=${result.updatedAt || "unknown"}`
      );
      callback(result.pairs);
    } else {
      console.log(
        `rotation_evt=skip source=poll reason=${result.reason} file=${filePath}`
      );
    }
  }

  // Initial load on startup
  const initial = loadActivePairs(opts);
  if (initial.ok) {
    console.log(
      `rotation_evt=apply source=startup pairs=${initial.pairs.join(",")} updated=${initial.updatedAt || "unknown"}`
    );
    callback(initial.pairs);
  } else {
    console.log(
      `rotation_evt=skip source=startup reason=${initial.reason} file=${filePath}`
    );
  }

  // Poll periodically
  setInterval(poll, pollSec * 1000);

  // SIGHUP reload support
  process.on("SIGHUP", () => {
    console.log("signal_evt=sighup action=reload_pairs");
    const reload = loadActivePairs(opts);
    if (reload.ok) {
      console.log(
        `rotation_evt=apply source=sighup pairs=${reload.pairs.join(",")} updated=${reload.updatedAt || "unknown"}`
      );
      callback(reload.pairs);
    } else {
      console.log(
        `rotation_evt=skip source=sighup reason=${reload.reason} file=${filePath}`
      );
    }
  });
}
