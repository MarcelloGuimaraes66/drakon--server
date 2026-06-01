import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/react-app/index.css";
import App from "@/react-app/App.tsx";
import { applyBrandMetadataToDocument } from "@/shared/brand";

applyBrandMetadataToDocument();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
