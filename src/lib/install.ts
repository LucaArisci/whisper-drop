import { useEffect, useState } from "react";
import type { InstallPromptState } from "../types";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function useInstallPrompt(): InstallPromptState {
  const [state, setState] = useState<InstallPromptState>({
    canInstall: false,
    prompt: null
  });

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      const deferred = event as BeforeInstallPromptEvent;
      setState({
        canInstall: true,
        prompt: async () => {
          await deferred.prompt();
          await deferred.userChoice;
          setState({
            canInstall: false,
            prompt: null
          });
        }
      });
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  return state;
}
