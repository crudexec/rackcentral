# Racking Maintenance Visualizer

A 3D warehouse racking visualization system with maintenance tracking, built with Next.js, Three.js, and Recharts.

## Features

- 🏭 **3D Racking Visualization** - Configurable warehouse racking with adjustable bays, levels, dimensions, and colors
- 🔧 **Maintenance Tracking** - Add, view, and manage maintenance records for individual components
- 📊 **Analytics Dashboard** - Visualize maintenance trends, component health, and activity over time
- 🎨 **View Modes** - Normal, Health Status, and Inspection Heatmap views
- 📷 **Camera Presets** - Quick-switch between Front, Side, Top, Isometric, and Back views
- 💾 **Export/Import** - Save and load your rack configuration and maintenance data as JSON
- 🎯 **Component Selection** - Click any component to view details, set health status, and add records

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

### Installation

1. Navigate to the project directory:
   ```bash
   cd racking-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and go to:
   ```
   http://localhost:3000
   ```

## Usage

### Navigation
- **Drag** - Rotate the camera around the rack
- **Scroll** - Zoom in/out
- **Click** - Select a component

### Tabs
- **Config** - Adjust rack dimensions, colors, and view modes
- **Timeline** - View all maintenance records chronologically
- **Component** - View/edit selected component details and history
- **Analytics** - View charts and statistics

### Adding Maintenance Records
1. Click on any rack component in the 3D view
2. Go to the "Component" tab
3. Click "+ Add Maintenance Record"
4. Fill in the details and save

### View Modes
- **Normal** - Default view showing components with maintenance records highlighted
- **Health** - Color-coded by component health status (Good/Fair/Poor/Critical)
- **Inspection** - Heatmap based on days since last inspection

### Saving Data
1. Click "💾 Save/Load" in the Config tab
2. Export to download a JSON file with all your data
3. Import to restore from a previously saved file

## Tech Stack

- **Next.js 14** - React framework
- **Three.js** - 3D graphics
- **Recharts** - Charts and analytics
- **Tailwind CSS** - Styling
- **TypeScript** - Type safety

## Project Structure

```
racking-app/
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── components/
│       └── RackingVisualizer.tsx
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── README.md
```

## License

MIT
