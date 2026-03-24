from app import app, db, Player

# All 46 players from PowerPoint
ppt_players = {
    1: "DILEEP", 2: "RAGHU", 3: "THEJAS", 4: "LAKSHMANA", 5: "ANVESH",
    6: "GOWTHAM", 7: "HEMANTH", 8: "BHARATH", 9: "SHARATH", 10: "JAGADEESH",
    11: "SAGAR", 12: "SANKETH", 13: "PRAMOD", 14: "NAVEEN", 15: "GANESH",
    16: "MANU", 17: "RAKESH", 18: "MAHESH", 19: "VASANTHA", 20: "VINAY",
    21: "RAJENDRA", 22: "SUNIL", 23: "MANOJ", 24: "AKASH", 25: "KARTHIK",
    26: "SAYED MOIZ", 27: "DARSHAN", 28: "ADITYA", 29: "JAYANTH", 30: "SIDDU",
    31: "SIDDU CHAND", 32: "ANIL KUMAR", 33: "GURU", 34: "ABHI", 35: "RAKESH PRABHU",
    36: "NANDAN", 37: "AKARSHA", 38: "RAHUL", 39: "PUSHAK", 40: "SACHIN",
    41: "JEEVAN", 42: "SANNA", 43: "NITHIN", 44: "SANDESH", 45: "YASHWANTH", 46: "YATHIN"
}

with app.app_context():
    # Get serial numbers from database
    db_serials = set(p.serial_number for p in Player.query.all())
    
    print("Total in PPT: 46")
    print(f"Total in DB: {len(db_serials)}")
    print(f"Missing: {46 - len(db_serials)}\n")
    
    print("Missing players:")
    missing = []
    for serial, name in ppt_players.items():
        if serial not in db_serials:
            missing.append((serial, name))
            print(f"  Serial {serial}: {name}")
    
    print(f"\nTotal missing: {len(missing)}")
