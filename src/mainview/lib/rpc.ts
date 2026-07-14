import { Electroview } from "electrobun/view";
import type { TutoRPC } from "../../shared/types";

type BridgeRpc = ReturnType<typeof Electroview.defineRPC<TutoRPC>>;
type BunRequests = BridgeRpc["request"];
type BunMessages = BridgeRpc["send"];

// Electroview writes to bridge globals that only exist inside the app shell —
// in a plain browser (vite dev server) construction throws, so guard it and
// fail on use instead of on import. Demo mode (?demo) can then still render.
function createBridge(): BridgeRpc | undefined {
	try {
		const rpc = Electroview.defineRPC<TutoRPC>({
			maxRequestTime: 300_000,
			handlers: {
				requests: {},
				messages: {},
			},
		});
		const electroview = new Electroview({ rpc });
		return electroview.rpc ?? undefined;
	} catch {
		return undefined;
	}
}

const bridge = createBridge();

export const bun: BunRequests =
	bridge?.request ??
	(new Proxy(
		{},
		{
			get: (_target, name) => () =>
				Promise.reject(
					new Error(
						`Electrobun RPC is unavailable outside the app (${String(name)})`,
					),
				),
		},
	) as BunRequests);

// Fire-and-forget messages to the bun process; no-op outside the app
export const bunSend: BunMessages =
	bridge?.send ??
	(new Proxy(
		{},
		{
			get: () => () => {},
		},
	) as BunMessages);
