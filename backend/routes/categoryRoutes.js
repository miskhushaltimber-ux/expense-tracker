import express from "express";
import { listCategories, addCategory, deleteCategory } from "../controllers/categoryController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", listCategories);
router.post("/", addCategory);
router.delete("/:id", deleteCategory);

export default router;
