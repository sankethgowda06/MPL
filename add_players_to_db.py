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
    updated_count = 0
    skipped_count = 0
    
    for player_data in players_data:
        serial_number = player_data['serial_number']
        player_name = player_data['name']
        role = player_data['role']
        photo_path = player_data['photo_path']

        # Keep DB synced with PPT by serial number
        existing_player = Player.query.filter_by(serial_number=serial_number).first()

        if existing_player:
            has_changes = (
                existing_player.name != player_name or
                existing_player.role != role or
                existing_player.photo_path != photo_path
            )

            if has_changes:
                existing_player.name = player_name
                existing_player.role = role
                existing_player.photo_path = photo_path
                print(f"↺ Updated: #{serial_number} {player_name} ({role})")
                updated_count += 1
            else:
                print(f"⊘ Skipped: #{serial_number} {player_name} (already up to date)")
                skipped_count += 1
            continue

        # Create new player when serial does not exist
        player = Player(
            serial_number=serial_number,
            name=player_name,
            role=role,
            photo_path=photo_path,
            is_available=True
        )

        db.session.add(player)
        print(f"✓ Added: #{serial_number} {player_name} ({role})")
        added_count += 1
    
    # Commit all changes
    db.session.commit()
    
    print(f"\n{'='*50}")
    print(f"✓ Total players added: {added_count}")
    print(f"↺ Total players updated: {updated_count}")
    print(f"⊘ Total players skipped: {skipped_count}")
    print(f"{'='*50}")
    print("All players added to database successfully!")
