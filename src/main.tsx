import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";

const MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === "false" ? false : import.meta.env.DEV;

async function bootstrap() {
  const root = document.getElementById("root")!;

  if (MOCK_AUTH) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  } else {
    const { msalInstance } = await import("./auth/msalConfig.js");
    const { MsalProvider } = await import("@azure/msal-react");

    await msalInstance.initialize();
    await msalInstance.initialize();
    await msalInstance.handleRedirectPromise({ navigateToLoginRequestUrl: false });
    createRoot(root).render(
      <StrictMode>
        <MsalProvider instance={msalInstance}>
          <App />
        </MsalProvider>
      </StrictMode>
    );
  }
}

bootstrap().catch(console.error);
