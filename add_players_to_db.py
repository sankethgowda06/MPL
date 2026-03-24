import json
import os
from app import app, db, Player

# Load extracted players data
json_file = r'c:\Users\Sanketh\Desktop\MPL\app\extracted_players.json'

with open(json_file, 'r') as f:
    players_data = json.load(f)

print("Adding players to database...\n")

with app.app_context():
    added_count = 0
    skipped_count = 0
    
    for player_data in players_data:
        player_name = player_data['name']
        
        # Check if player already exists
        if Player.query.filter_by(name=player_name).first():
            print(f"⊘ Skipped: {player_name} (already exists)")
            skipped_count += 1
            continue
        
        # Create new player
        player = Player(
            serial_number=player_data['serial_number'],
            name=player_name,
            role=player_data['role'],
            photo_path=player_data['photo_path'],
            is_available=True
        )
        
        db.session.add(player)
        print(f"✓ Added: {player_name} ({player_data['role']})")
        added_count += 1
    
    # Commit all changes
    db.session.commit()
    
    print(f"\n{'='*50}")
    print(f"✓ Total players added: {added_count}")
    print(f"⊘ Total players skipped: {skipped_count}")
    print(f"{'='*50}")
    print("All players added to database successfully!")
