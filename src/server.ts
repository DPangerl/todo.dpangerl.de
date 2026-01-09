import express from "express";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3007;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "changeme";

// Simple token storage (in production, use a proper session store)
const validTokens = new Set<string>();

// Generate a simple auth token
function generateToken(): string {
  return uuidv4() + "-" + Date.now();
}

// Verify token
function isValidToken(token: string | undefined): boolean {
  return token ? validTokens.has(token) : false;
}

// File paths
const PRINTED_TODOS_FILE = path.join(__dirname, "../data/printed-todos.json");
const DATA_DIR = path.join(__dirname, "../data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Types
interface RegularTodo {
  id: string;
  type?: "TODO";
  todo: string;
  deadline?: string;
  assignee: string;
  createdAt: string;
}

interface ShoppingList {
  id: string;
  type: "SHOPPING_LIST";
  title: string;
  items: string[];
  createdAt: string;
}

type Todo = RegularTodo | ShoppingList;

interface PrintedTodo extends RegularTodo {
  printedAt: string;
}

interface PrintedShoppingList extends ShoppingList {
  printedAt: string;
}

type PrintedItem = PrintedTodo | PrintedShoppingList;

interface PrinterStatus {
  printer_id: string;
  current_status: string;
  last_updated: string;
  is_online: boolean;
  has_error: boolean;
  error_type: string | null;
  description: string;
  can_print: boolean;
}

interface PrintStats {
  totalPrinted: number;
  lastPrintTime?: string;
  printErrors: number;
}

// In-memory storage
let todos: Todo[] = [];
let printerStatus: PrinterStatus = {
  printer_id: "EPSON_TM-T88V",
  current_status: "offline",
  last_updated: new Date().toISOString(),
  is_online: false,
  has_error: false,
  error_type: null,
  description: "Printer is offline",
  can_print: false,
};
let printStats: PrintStats = {
  totalPrinted: 0,
  printErrors: 0,
};

// Helper functions for printed todos
function loadPrintedItems(): PrintedItem[] {
  try {
    if (fs.existsSync(PRINTED_TODOS_FILE)) {
      const data = fs.readFileSync(PRINTED_TODOS_FILE, "utf8");
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error("Error loading printed items:", error);
    return [];
  }
}

function savePrintedItems(printedItems: PrintedItem[]): void {
  try {
    fs.writeFileSync(PRINTED_TODOS_FILE, JSON.stringify(printedItems, null, 2));
  } catch (error) {
    console.error("Error saving printed items:", error);
  }
}

function addToPrintedItems(item: Todo): void {
  const printedItems = loadPrintedItems();
  const printedItem: PrintedItem = {
    ...item,
    printedAt: new Date().toISOString(),
  } as PrintedItem;
  printedItems.push(printedItem);
  savePrintedItems(printedItems);
}

// Type guard for shopping list
function isShoppingList(item: Todo): item is ShoppingList {
  return item.type === "SHOPPING_LIST";
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));

// Middleware to check if printer status is stale (older than 10 seconds)
app.use((req, res, next) => {
  const now = new Date();
  const lastUpdated = new Date(printerStatus.last_updated);
  const timeDiff = now.getTime() - lastUpdated.getTime();

  // If status is older than 10 seconds and not already offline, mark as offline
  if (timeDiff > 10000 && printerStatus.is_online) {
    printerStatus = {
      ...printerStatus,
      current_status: "offline",
      last_updated: now.toISOString(),
      is_online: false,
      has_error: true,
      error_type: "timeout",
      description: "Printer connection timeout - no updates for 10+ seconds",
      can_print: false,
    };
  }

  next();
});

// Authentication endpoints (no auth required)
app.post("/auth/login", (req, res) => {
  const { password } = req.body;

  if (password === AUTH_PASSWORD) {
    const token = generateToken();
    validTokens.add(token);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: "Invalid password" });
  }
});

app.post("/auth/verify", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (isValidToken(token)) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

app.post("/auth/logout", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    validTokens.delete(token);
  }
  res.json({ success: true });
});

// Authentication middleware for protected routes
app.use((req, res, next) => {
  // Skip auth for static files and auth endpoints
  if (
    req.path.startsWith("/auth/") ||
    req.path === "/" ||
    req.path.endsWith(".html") ||
    req.path.endsWith(".css") ||
    req.path.endsWith(".js") ||
    req.path.endsWith(".ico")
  ) {
    return next();
  }

  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!isValidToken(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

// Routes

// 1. Index route - serves the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// 2. Todos routes - Optimized for POS printer polling
app.get("/todos", (req, res) => {
  // Sort by deadline for printer (todos with deadlines first, then by creation time)
  const sortedTodos = todos.sort((a, b) => {
    const aDeadline = "deadline" in a ? a.deadline : undefined;
    const bDeadline = "deadline" in b ? b.deadline : undefined;
    // If both have deadlines, sort by deadline
    if (aDeadline && bDeadline) {
      return new Date(aDeadline).getTime() - new Date(bDeadline).getTime();
    }
    // If only one has deadline, it goes first
    if (aDeadline && !bDeadline) return -1;
    if (!aDeadline && bDeadline) return 1;
    // If neither has deadline, sort by creation time
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  res.json(sortedTodos);
});

app.post("/todos", (req, res) => {
  const { type, todo, deadline, assignee, title, items } = req.body;

  // Handle shopping list
  if (type === "SHOPPING_LIST") {
    if (!title || !items || !Array.isArray(items)) {
      return res
        .status(400)
        .json({ error: "Shopping list requires: title, items (array)" });
    }

    const newShoppingList: ShoppingList = {
      id: uuidv4(),
      type: "SHOPPING_LIST",
      title,
      items,
      createdAt: new Date().toISOString(),
    };

    todos.push(newShoppingList);
    return res.status(201).json(newShoppingList);
  }

  // Handle regular todo
  if (!todo) {
    return res
      .status(400)
      .json({ error: "Missing required field: todo" });
  }

  const newTodo: RegularTodo = {
    id: uuidv4(),
    todo,
    deadline: deadline || undefined,
    assignee: assignee || "",
    createdAt: new Date().toISOString(),
  };

  todos.push(newTodo);
  res.status(201).json(newTodo);
});

// Bulk delete - for printer service
app.delete("/todos", (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: "Missing required field: ids (array)" });
  }

  const deletedIds: string[] = [];

  for (const id of ids) {
    const itemToDelete = todos.find((item) => item.id === id);
    if (itemToDelete) {
      addToPrintedItems(itemToDelete);
      deletedIds.push(id);
      printStats.totalPrinted++;
    }
  }

  todos = todos.filter((item) => !deletedIds.includes(item.id));
  printStats.lastPrintTime = new Date().toISOString();

  res.json({ deleted: deletedIds.length, ids: deletedIds });
});

// Single delete - for UI
app.delete("/todos/:id", (req, res) => {
  const { id } = req.params;
  const itemToDelete = todos.find((item) => item.id === id);

  if (!itemToDelete) {
    return res.status(404).json({ error: "Item not found" });
  }

  // Add to printed items file
  addToPrintedItems(itemToDelete);

  // Remove from active todos
  todos = todos.filter((item) => item.id !== id);

  // Track successful print
  printStats.totalPrinted++;
  printStats.lastPrintTime = new Date().toISOString();

  res.status(204).send();
});

// New endpoint to retrieve printed todos history
app.get("/printed-todos", (req, res) => {
  const printedItems = loadPrintedItems();

  // Sort by printedAt timestamp, most recent first
  const sortedPrintedItems = printedItems.sort(
    (a, b) => new Date(b.printedAt).getTime() - new Date(a.printedAt).getTime()
  );

  res.json(sortedPrintedItems);
});

// 3. Printer status routes - Enhanced for POS monitoring
app.put("/printer-status", (req, res) => {
  const {
    printer_id,
    current_status,
    is_online,
    has_error,
    error_type,
    description,
    can_print,
  } = req.body;

  if (!current_status) {
    return res.status(400).json({ error: "current_status is required" });
  }

  printerStatus = {
    printer_id: printer_id || printerStatus.printer_id,
    current_status,
    last_updated: new Date().toISOString(),
    is_online: is_online !== undefined ? is_online : true,
    has_error: has_error !== undefined ? has_error : false,
    error_type: error_type || null,
    description: description || `Printer status: ${current_status}`,
    can_print: can_print !== undefined ? can_print : true,
  };

  // Track error if status indicates problem
  if (
    has_error ||
    current_status.toLowerCase().includes("error") ||
    current_status.toLowerCase().includes("jam")
  ) {
    printStats.printErrors++;
  }

  res.json(printerStatus);
});

app.get("/printer-status", (req, res) => {
  res.json(printerStatus);
});

// Test endpoint to simulate different printer statuses
app.post("/test-status/:status", (req, res) => {
  const { status } = req.params;

  switch (status) {
    case "online":
      printerStatus = {
        printer_id: "EPSON_TM-T88V",
        current_status: "online",
        last_updated: new Date().toISOString(),
        is_online: true,
        has_error: false,
        error_type: null,
        description: "Printer is ready and operational",
        can_print: true,
      };
      break;
    case "paper_jam":
      printerStatus = {
        printer_id: "EPSON_TM-T88V",
        current_status: "paper_jam",
        last_updated: new Date().toISOString(),
        is_online: false,
        has_error: true,
        error_type: "paper_jam",
        description: "Paper jam detected - please clear the jam",
        can_print: false,
      };
      break;
    case "paper_empty":
      printerStatus = {
        printer_id: "EPSON_TM-T88V",
        current_status: "paper_empty",
        last_updated: new Date().toISOString(),
        is_online: false,
        has_error: true,
        error_type: "paper_empty",
        description: "Paper is empty - please refill paper",
        can_print: false,
      };
      break;
    default:
      return res.status(400).json({ error: "Unknown status" });
  }

  res.json({ message: `Status set to ${status}`, printerStatus });
});

// Additional endpoint for print statistics
app.get("/print-stats", (req, res) => {
  const printedItems = loadPrintedItems();

  res.json({
    ...printStats,
    pendingTodos: todos.length,
    totalPrintedFromFile: printedItems.length,
    printerOnline: printerStatus.is_online,
    lastActivity: printerStatus.last_updated,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
