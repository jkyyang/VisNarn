/** Whether the side panel is open or collapsed. This browser keeps the choice; the camera frames the map beside the open panel (./App.tsx). */
import { storedChoice } from "../ui/stored.ts";

export type PanelState = "open" | "collapsed";

export const usePanelState = storedChoice<PanelState>("visnarn.panel", ["open", "collapsed"], () => "open");
