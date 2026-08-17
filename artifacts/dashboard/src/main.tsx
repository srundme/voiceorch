import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadHostBrand } from "./lib/white-label";

void loadHostBrand();

createRoot(document.getElementById("root")!).render(<App />);
