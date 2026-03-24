from app import app, db, Player

with app.app_context():
    total = Player.query.count()
    available = Player.query.filter_by(is_available=True).count()
    auctioned = Player.query.filter_by(is_available=False).count()

    print(f"Total players in DB: {total}")
    print(f"Available players: {available}")
    print(f"Auctioned players: {auctioned}")
    print(f"\nAll players:")
    players = Player.query.all()
    for p in players:
        print(f"  {p.id:3d}: Serial={p.serial_number:2d}, Name={p.name:20s}, Available={p.is_available}")
