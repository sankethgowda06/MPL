from app import app, db, Player
import os

missing_players = [
    (14, "NAVEEN", "BATSMAN"),
    (22, "SUNIL", "BATSMAN"),
    (30, "SIDDU", "BATSMAN"),
    (31, "SIDDU CHAND", "BATSMAN"),
    (35, "RAKESH PRABHU", "BATSMAN"),
]

with app.app_context():
    print("Adding missing players...")
    for serial, name, role in missing_players:
        # Check if already exists
        if Player.query.filter_by(serial_number=serial).first():
            print(f"  Serial {serial}: {name} - Already exists")
            continue
        
        # Create new player
        player = Player(
            serial_number=serial,
            name=name,
            role=role,
            is_available=True
        )
        db.session.add(player)
        print(f"  Serial {serial}: {name} - Added")
    
    db.session.commit()
    
    # Verify
    total = Player.query.count()
    print(f"\nTotal players in DB now: {total}")
