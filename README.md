# 🏏 MPL Cricket League - Auction Management System

A complete web application to manage cricket league player auctions with team budgets, player tracking, and real-time budget monitoring.

## Features

✅ **Team Management**
- Create and manage teams
- Each team gets 100,000 points budget
- Real-time budget tracking
- View team rosters

✅ **Player Auction**
- Import players from Excel (with serial number, name, role, and photos)
- Auction players to teams with bidding (minimum 1000 points)
- Auto-deduct budget when players are added
- Players automatically removed from available list

✅ **Dashboard**
- Overall statistics (total, available, auctioned players)
- Team rankings with budget overview
- Real-time updates

✅ **Data Management**
- Export league data to Excel
- Save all team rosters
- Track auction history

## Setup Instructions

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run the Application
```bash
python app.py
```

The app will be available at `http://localhost:5000`

### 3. Initial Setup

**Step 1: Import Players**
- Go to "Players" tab
- Click "Import Players from Excel"
- Select your `Player_List.xlsx` file
- All 46 players will be imported with their roles

**Step 2: Create Teams**
- Go to "Teams" tab
- Enter team name
- Click "Create Team"
- Repeat for all teams (e.g., CSK, RCB, MI, etc.)

**Step 3: Start Auction**
- Go to "Auction" tab
- Select Team
- Select Player
- Enter bid price (minimum 1000 points)
- Click "Add Player to Team"
- Player is removed from available list
- Budget is automatically deducted

**Step 4: Monitor & Export**
- Check "Dashboard" for league overview
- View team rosters by clicking "View Roster"
- Export final data with "Download Excel Report"

## File Structure

```
MPL/app/
├── app.py                    # Flask backend
├── requirements.txt          # Python dependencies
├── Player_List.xlsx          # Excel with player data
├── templates/
│   └── index.html           # Main HTML template
├── static/
│   ├── style.css            # Styling
│   └── script.js            # Frontend logic
└── mpl_league.db            # SQLite database (auto-created)
```

## Usage Tips

### Budget Management
- Each team starts with 100,000 points
- Minimum bid for any player: 1000 points
- Available budget shown in real-time
- Prevent overbidding (system validates)

### Player Management
- Players shown with serial number, name, and role
- Once auctioned, removed from available players
- Can be removed from team to make available again

### Data Export
- Download complete league data as Excel
- Includes team summaries, rosters, and available players
- Use for reports and analysis

## Default Players

The Excel file includes 46 cricket players with:
- **Serial Number**: 1-46
- **Player Names**: DILEEP, RAGHU, THEJAS, SHARATH, etc.
- **Roles**: ALL-ROUNDER, BATSMAN
- **Photos**: Embedded in Excel and extracted to `player_photos/` folder

## Database

The application uses SQLite for persistence:
- Teams and budgets are saved
- Auctioned players are tracked
- All data persists between sessions
- Database auto-created on first run

## Notes

- Application runs in development mode by default (debug=True)
- For production, change `debug=True` to `debug=False` in app.py
- Database file: `mpl_league.db` (auto-created in app folder)
- All prices in Indian Rupees (₹) for display purposes

## Future Enhancements

Possible features to add:
- User authentication (admin/team owners)
- Email notifications for auctions
- Live auction bidding/timer
- Player performance statistics
- Wallet integration
- Mobile app
- Predictions and analytics
