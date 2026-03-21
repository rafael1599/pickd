# Roman Inv - Inventory Management PWA

High-performance, multi-user Inventory Management System powered by **Supabase** and **Google Gemini AI**.

## 🚀 Reality Check: Current State

The system has matured from a CSV-based prototype into a full-scale warehouse orchestration platform:
- **Database**: 100% migrated to Supabase (PostgreSQL) with Real-time synchronization.
- **Language**: Core logic and Smart Picking migrated to **TypeScript** for enterprise-grade reliability.
- **AI**: Dual-provider fallback system (Gemini 2.5 Flash + GPT-4o).

## Features

### Core Warehouse Management

- 📱 **Mobile-First Design** - Optimized for high-speed warehouse operations on iPhone/PWA.
- 🔄 **Real-time Sync** - Direct Supabase integration for multi-user inventory consistency.
- 🔍 **Global Search** - Instant filtering by SKU, Location, or Metadata.
- 🏗️ **Zone Optimization** - Organize warehouse into HOT, WARM, and COLD zones.
- 📊 **Dual Inventory** - Specialized tracking for Ludlow (General) and ATS (High Density) grids.
- 🛠️ **Location HUD** - Interactive location editor with capacity validation and picking priority.

### 🤖 Smart Picking (AI-Powered)

- 📸 **AI Order Extraction** - Scan physical invoices; Gemini extracts items and quantities automatically.
- 🧠 **Hybrid Reasoning** - Powered by Gemini 2.5 Flash with automatic fallback to OpenAI GPT-4o.
- 📦 **Auto Palletization** - Order splitting into pallets (max 13 items per pallet) with footprint calculation.
- 🏷️ **Pallet Labels** - Print shipping labels with order number, item list, and weights.
- 🔀 **Warehouse Selection** - Choose between Ludlow/ATS when SKUs exist in both warehouses.
- ✏️ **Picking Notes & Corrections** - Attach notes to picks; correction timeline for audit trail.
- ⚖️ **Weight Tracking** - Per-item weight (lbs) with inline editing and label integration.
- ↩️ **Inventory Undo** - Single-click restoration of any inventory movement (add, edit, move, delete).

### Planned

- 📸 **Photo Verification** - AI-driven validation of completed pallets.
- 📊 **Performance Analytics Dashboard** - Supervisor view with per-user productivity metrics.

## Installation

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and provide your Supabase and AI provider credentials:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_API_KEY=...
VITE_OPENAI_API_KEY=... # Optional fallback
```

### 3. Start Development Server

```bash
pnpm run dev
```

The app is accessible at http://localhost:5173/ and automatically broadcasts to your local network.

## Technical Architecture

The project follows a **Feature-Sliced Design (FSD)** inspired architecture for maximum modularity. For a deep dive into the internal structure, see [ARCHITECTURE.md](./ARCHITECTURE.md).

- **Frontend**: React 19 + Vite + Tailwind CSS + **TypeScript**.
- **State & Data**: TanStack Query (React Query) + Supabase Client with Optimistic Updates.
- **Storage**: PostgreSQL (via Supabase) with Row Level Security (RLS).
- **Communication**: Real-time Postgres changes for instant multi-user updates.
- **Project Structure**: Organized by `features/` (Inventory, Picking, Smart-Picking, etc.).

## Usage Guide

### Picking Flow
1. **Deduction & Validation**: As items are scanned or added to a picking session, the system validates stock in real-time.
2. **Route Optimization**: The system calculates the shortest path through the warehouse based on your custom map.
3. **Session Persistence**: Picking progress is synced across users. An admin can "Double Check" a pallet before finalizing.
4. **Finalization**: Inventory is deducted from Supabase, and a comprehensive log is created with an optional PDF report.

## Tech Stack (Current)

- **React 19** - UI Core
- **TypeScript** - Type safety and documentation
- **Supabase** - Authentication, Database, and Real-time
- **Vite** - Build & Dev ecosystem
- **Tailwind CSS** - Design system
- **Google Gemini 2.5 Flash** - Vision & Extraction AI
- **AI Agent Skills** - Specialized workflows for frontend design, database performance, and artifact building.

## AI Agent Skills

Skills are managed from the `my-agent-skills` repo (single source of truth). This project declares its dependencies in `.skills-config.json` and syncs them via `scripts/sync-skills.ps1`.

Active skills:
- **frontend-design**: UX/UI standards and modern component patterns.
- **supabase-postgres-best-practices**: Hardened database schema and RPC patterns.
- **vercel-react-best-practices**: Optimization for performance and React 19 standards.

## Troubleshooting

**Q: Inventory changes aren't syncing?**
- Verify your internet connection; Supabase requires an active link for real-time updates.
- Check the browser console for RLS (Row Level Security) violations.

**Q: AI scanning is slow or failing?**
- The system will fallback to OpenAI if Gemini is overloaded.
- Ensure the invoice is well-lit and the camera is in focus.

---

_Project maintained by the Roman App Engineering Team._
