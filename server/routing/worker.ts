/**
 * A routing worker thread: loads the network, owns one CarRouter, answers one job at a time.
 * Node runs this file directly (type stripping); there is no build step for it.
 */
import { isMainThread, parentPort, workerData, type MessagePort } from "node:worker_threads";
import { createCarRouter, loadNetwork } from "../../engine/index.ts";
import type { Job, JobResult, WorkerData } from "./protocol.ts";

export function runWorker(port: MessagePort, data: WorkerData): void {
  const router = createCarRouter(loadNetwork(data.networkDir));
  port.on("message", (job: Job) => {
    let answer: JobResult;
    try {
      answer = { id: job.id, result: router.route(job.trip, job.strategy) };
    } catch (error) {
      // "No route" is an answer, so anything thrown here is a bug: report it and keep serving.
      answer = { id: job.id, failed: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(answer);
  });
}

if (!isMainThread && parentPort) runWorker(parentPort, workerData as WorkerData);
