/**
 * Example workflows.
 *
 * Each example is a self-contained, offline-runnable workflow that shows how to
 * compose nodes with the engine. The lead nodes are illustrative stand-ins with
 * comments pointing at the real integration nodes to swap in. Copy an example,
 * replace the stand-ins, and wire your own services.
 */

export {
	buildCommunityResponderWorkflow,
	type CommunityResponderConfig,
	createCommunityResponderRegistry,
	runCommunityResponder,
} from "./community-responder.js";
export {
	buildDailyContentPublisherWorkflow,
	createDailyContentPublisherRegistry,
	type DailyContentPublisherConfig,
	runDailyContentPublisher,
} from "./daily-content-publisher.js";
export type { LlmService } from "./shared.js";
export {
	buildSourceMonitorWorkflow,
	createSourceMonitorRegistry,
	runSourceMonitor,
	type SourceMonitorConfig,
} from "./source-monitor.js";
export {
	buildVideoPipelineWorkflow,
	createVideoPipelineRegistry,
	runVideoPipeline,
	type VideoPipelineConfig,
} from "./video-pipeline.js";
