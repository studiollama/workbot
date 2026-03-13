import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ServicesProvider } from "./context/ServicesContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ServicesProvider>
      <App />
    </ServicesProvider>
  </StrictMode>
);
