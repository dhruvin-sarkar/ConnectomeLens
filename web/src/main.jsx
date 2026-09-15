import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/figures.css";
import "./styles/findings.css";
import "./styles/tools.css";
import "./styles/methods.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
