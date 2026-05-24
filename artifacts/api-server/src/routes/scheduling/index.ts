import { Router, type IRouter } from "express";
import calendarsRouter from "./calendars.js";
import eventTypesRouter from "./event-types.js";
import availabilityRouter from "./availability.js";
import slotsRouter from "./slots.js";
import bookingsRouter from "./bookings.js";
import publicRouter from "./public.js";

const router: IRouter = Router();

router.use(publicRouter);
router.use(calendarsRouter);
router.use(eventTypesRouter);
router.use(availabilityRouter);
router.use(slotsRouter);
router.use(bookingsRouter);

export default router;
