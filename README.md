# Todo Web App

A simple todo management web application built with TypeScript, Express, and Tailwind CSS.

## Features

- **Add Todos**: Create todos with deadline, description, and assignee
- **View Todos**: See all todos in a clean, responsive interface
- **Delete Todos**: Remove todos with confirmation
- **Printer Status**: Track and update printer status

## API Endpoints

### Todos

- `GET /todos` - Get all todos as JSON
- `POST /todos` - Add a new todo
  ```json
  {
    "todo": "Task description",
    "deadline": "2025-08-21T15:30:00",
    "assignee": "John Doe"
  }
  ```
- `DELETE /todos/:id` - Delete a todo by ID

### Printer Status

- `GET /printer-status` - Get current printer status
- `POST /printer-status` - Update printer status
  ```json
  {
    "status": "online"
  }
  ```

### Web Interface

- `GET /` - Main todo management interface

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start development server:

   ```bash
   npm run dev
   ```

3. Open http://localhost:3000 in your browser

## Scripts

- `npm run dev` - Start development server with auto-reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server (after building)

## Tech Stack

- **Backend**: TypeScript, Express.js, Node.js
- **Frontend**: Vanilla JavaScript, HTML5, Tailwind CSS
- **Storage**: In-memory (resets on server restart)

## Project Structure

```
├── src/
│   └── server.ts          # Express server with API routes
├── public/
│   └── index.html         # Frontend interface
├── package.json
├── tsconfig.json
└── README.md
```
