import { db } from "@workspace/db";
import { createSalesRouter } from "../sales/router.js";

const router = createSalesRouter(db);

export default router;
