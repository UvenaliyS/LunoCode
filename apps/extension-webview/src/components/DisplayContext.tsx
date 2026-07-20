import { createContext, useContext } from "react";
import type { DisplaySettings } from "../contracts";
import { DEFAULT_DISPLAY } from "../contracts";

/**
 * Display preferences (collapse defaults, ui scale) surfaced to deep render
 * components — AgentSteps reads the collapse flags without threading them
 * through MessageList's prop chain. Provided by App from host `state`.
 */
export const DisplayContext = createContext<DisplaySettings>(DEFAULT_DISPLAY);

export function useDisplay(): DisplaySettings {
  return useContext(DisplayContext);
}
