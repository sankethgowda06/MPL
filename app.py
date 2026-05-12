from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from datetime import datetime
import os
import json
from io import BytesIO
from werkzeug.utils import secure_filename
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///mpl_league.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['PLAYER_PHOTOS_FOLDER'] = 'player_photos'
app.config['TEAM_LOGOS_FOLDER'] = 'team_logos'
app.config['REPORTS_FOLDER'] = 'reports'

ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

db = SQLAlchemy(app)
migrate = Migrate(app, db)

# Database Models
class Team(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    owner = db.Column(db.String(100), nullable=False)
    budget = db.Column(db.Integer, default=100000)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    players = db.relationship('AuctionedPlayer', backref='team', lazy=True, cascade='all, delete-orphan')

    def to_dict(self, include_players=False):
        logo_url = None
        logo_filename = get_team_logo_filename(self.id)
        if logo_filename:
            logo_url = team_logo_public_url(logo_filename)

        data = {
            'id': self.id,
            'name': self.name,
            'owner': self.owner,
            'budget': self.budget,
            'total_spent': sum(p.price for p in self.players),
            'players_count': len(self.players),
            'available_budget': self.budget - sum(p.price for p in self.players),
            'logo_url': logo_url
        }
        
        if include_players:
            players_list = []
            for auctioned_player in self.players:
                player_data = auctioned_player.player_ref.to_dict()
                player_data['price'] = auctioned_player.price
                players_list.append(player_data)
            data['players'] = players_list
        
        return data


class Player(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    serial_number = db.Column(db.Integer, unique=True)
    name = db.Column(db.String(100), nullable=False)
    role = db.Column(db.String(50), nullable=False)
    photo_path = db.Column(db.String(200))
    is_available = db.Column(db.Boolean, default=True)
    auctioned_players = db.relationship('AuctionedPlayer', backref='player_ref', lazy=True)

    def to_dict(self):
        # Extract filename from photo_path
        photo_url = None
        if self.photo_path:
            photo_filename = os.path.basename(self.photo_path)
            photo_url = f'/photos/{photo_filename}'
        
        return {
            'id': self.id,
            'serial_number': self.serial_number,
            'name': self.name,
            'role': self.role,
            'photo_path': self.photo_path,
            'photo_url': photo_url,
            'is_available': self.is_available
        }


class AuctionedPlayer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey('team.id'), nullable=False)
    player_id = db.Column(db.Integer, db.ForeignKey('player.id'), nullable=False)
    price = db.Column(db.Integer, nullable=False)
    auctioned_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'player': self.player_ref.to_dict(),
            'price': self.price,
            'auctioned_at': self.auctioned_at.isoformat()
        }


class TeamLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey('team.id'), nullable=False)
    player_id = db.Column(db.Integer, db.ForeignKey('player.id'))
    player_serial = db.Column(db.Integer)
    player_name = db.Column(db.String(100), nullable=False)
    player_role = db.Column(db.String(50), nullable=False)
    action = db.Column(db.String(20), nullable=False)  # BIDDED / REMOVED
    price = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'team_id': self.team_id,
            'player_id': self.player_id,
            'player_serial': self.player_serial,
            'player_name': self.player_name,
            'player_role': self.player_role,
            'action': self.action,
            'price': self.price,
            'created_at': self.created_at.isoformat()
        }


# Routes
def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def is_allowed_image(filename):
    if not filename or '.' not in filename:
        return False
    return filename.rsplit('.', 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def list_team_logo_filenames(team_id):
    logos_dir = app.config['TEAM_LOGOS_FOLDER']
    ensure_dir(logos_dir)
    prefix = f'team_{team_id}.'
    return [name for name in os.listdir(logos_dir) if name.lower().startswith(prefix)]


def get_team_logo_filename(team_id):
    logos_dir = app.config['TEAM_LOGOS_FOLDER']
    names = list_team_logo_filenames(team_id)
    if not names:
        return None
    if len(names) == 1:
        return names[0]
    paths = [(n, os.path.getmtime(os.path.join(logos_dir, n))) for n in names]
    paths.sort(key=lambda x: -x[1])
    return paths[0][0]


def remove_all_team_logos(team_id):
    logos_dir = app.config['TEAM_LOGOS_FOLDER']
    for name in list_team_logo_filenames(team_id):
        path = os.path.join(logos_dir, name)
        if os.path.exists(path):
            os.remove(path)


def team_logo_public_url(logo_filename):
    """URL with cache-buster so replacements show without stale browser cache."""
    if not logo_filename:
        return None
    logos_dir = app.config['TEAM_LOGOS_FOLDER']
    path = os.path.join(logos_dir, logo_filename)
    try:
        v = int(os.path.getmtime(path))
    except OSError:
        v = 0
    return f'/team-logos/{logo_filename}?v={v}'


def cleanup_orphan_bid_data():
    """Remove roster/log rows for teams that no longer exist (e.g. team deleted without UI removal)."""
    valid_team_ids = {row[0] for row in Team.query.with_entities(Team.id).all()}
    removed_auctions = 0
    removed_logs = 0

    for ap in list(AuctionedPlayer.query.all()):
        if ap.team_id not in valid_team_ids:
            db.session.delete(ap)
            removed_auctions += 1

    for log in list(TeamLog.query.all()):
        if log.team_id not in valid_team_ids:
            db.session.delete(log)
            removed_logs += 1

    if removed_auctions or removed_logs:
        db.session.commit()
    return removed_auctions, removed_logs


def reconcile_player_availability():
    """Set Player.is_available from AuctionedPlayer rows (fixes stale flags after team delete)."""
    fixed = 0
    for player in Player.query.all():
        has_auction = AuctionedPlayer.query.filter_by(player_id=player.id).first() is not None
        want = not has_auction
        if player.is_available != want:
            player.is_available = want
            fixed += 1
    if fixed:
        db.session.commit()
    return fixed


def add_team_log(team_id, player, action, price):
    log = TeamLog(
        team_id=team_id,
        player_id=player.id if player else None,
        player_serial=player.serial_number if player else None,
        player_name=player.name if player else 'Unknown',
        player_role=player.role if player else 'Unknown',
        action=action,
        price=price or 0
    )
    db.session.add(log)


def build_team_players_pdf(output_path):
    teams = Team.query.order_by(Team.name.asc()).all()
    page_width, page_height = A4
    pdf = canvas.Canvas(output_path, pagesize=A4)

    margin_x = 24
    y = page_height - 24
    content_width = page_width - (2 * margin_x)

    card_w = content_width
    card_h = 90
    photo_w = 52
    photo_h = 68
    row_h = card_h + 8

    pdf.setTitle("MPL Team Player List")
    pdf.setFont("Helvetica-Bold", 15)
    pdf.drawString(margin_x, y, "MPL Team Player List")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(margin_x, y - 13, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    y -= 30

    for team in teams:
        team_players = sorted(team.players, key=lambda a: a.player_ref.serial_number or 0)
        spent = sum(p.price for p in team.players)
        remaining = team.budget - spent

        if y < 90:
            pdf.showPage()
            y = page_height - 24

        # Highlight team header bar
        bar_h = 22
        pdf.setFillColor(colors.HexColor("#1E3A8A"))
        pdf.roundRect(margin_x, y - bar_h + 4, content_width, bar_h, 6, stroke=0, fill=1)
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(margin_x + 8, y - 9, f"TEAM: {team.name.upper()}")
        pdf.setFont("Helvetica", 9)
        pdf.drawRightString(margin_x + content_width - 8, y - 9, f"Players: {len(team_players)}  Remaining: ₹{remaining:,}")
        pdf.setFillColor(colors.black)
        y -= 24

        pdf.setFont("Helvetica", 9)
        pdf.drawString(margin_x, y, f"Owner: {team.owner}")
        y -= 14

        if not team_players:
            pdf.setFont("Helvetica-Oblique", 9)
            pdf.drawString(margin_x, y, "No players bidded yet.")
            y -= 18
            continue

        for auctioned in team_players:
            if y < (row_h + 18):
                pdf.showPage()
                y = page_height - 24

            card_x = margin_x
            card_y = y - card_h
            player = auctioned.player_ref
            photo_path = player.photo_path

            # Card background
            pdf.setFillColor(colors.HexColor("#F8FAFC"))
            pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
            pdf.roundRect(card_x, card_y, card_w, card_h, 8, stroke=1, fill=1)
            pdf.setFillColor(colors.black)

            # Photo block
            photo_x = card_x + 10
            photo_y = card_y + (card_h - photo_h) / 2
            if photo_path and os.path.exists(photo_path):
                try:
                    img = ImageReader(photo_path)
                    pdf.drawImage(
                        img,
                        photo_x,
                        photo_y,
                        width=photo_w,
                        height=photo_h,
                        preserveAspectRatio=True,
                        anchor='c'
                    )
                except Exception:
                    pdf.setStrokeColor(colors.HexColor("#94A3B8"))
                    pdf.rect(photo_x, photo_y, photo_w, photo_h, stroke=1, fill=0)
                    pdf.setFont("Helvetica", 7)
                    pdf.drawString(photo_x + 10, photo_y + 28, "No")
                    pdf.drawString(photo_x + 5, photo_y + 16, "Photo")
            else:
                pdf.setStrokeColor(colors.HexColor("#94A3B8"))
                pdf.rect(photo_x, photo_y, photo_w, photo_h, stroke=1, fill=0)
                pdf.setFont("Helvetica", 7)
                pdf.drawString(photo_x + 10, photo_y + 28, "No")
                pdf.drawString(photo_x + 5, photo_y + 16, "Photo")

            text_x = photo_x + photo_w + 12
            text_y = card_y + card_h - 16
            pdf.setFillColor(colors.HexColor("#0F172A"))
            pdf.setFont("Helvetica-Bold", 11)
            pdf.drawString(text_x, text_y, f"#{player.serial_number} {player.name}")

            pdf.setFont("Helvetica", 9)
            pdf.setFillColor(colors.HexColor("#334155"))
            pdf.drawString(text_x, text_y - 15, f"Role: {player.role}")
            pdf.drawString(text_x, text_y - 30, f"Bid Amount: ₹{auctioned.price:,}")
            pdf.drawString(text_x, text_y - 45, f"Bought At: {auctioned.auctioned_at.strftime('%d-%m-%Y %I:%M %p')}")

            y -= row_h

        y -= 10

    pdf.save()

@app.route('/photos/<filename>')
def get_photo(filename):
    try:
        photos_dir = app.config['PLAYER_PHOTOS_FOLDER']
        return send_from_directory(photos_dir, filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/team-logos/<filename>')
def get_team_logo(filename):
    try:
        logos_dir = app.config['TEAM_LOGOS_FOLDER']
        ensure_dir(logos_dir)
        return send_from_directory(logos_dir, filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 404

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/bidding')
def bidding():
    return render_template('bidding.html')

@app.route('/viewer')
def viewer():
    return render_template('viewer.html')

@app.route('/api/teams', methods=['GET', 'POST'])
def teams():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        team_name = (data.get('name') or '').strip()
        team_owner = (data.get('owner') or '').strip()

        # Backward compatible: allow creating team even if older UI doesn't send owner
        if not team_owner:
            team_owner = 'N/A'
        
        if not team_name:
            return jsonify({'error': 'Team name is required'}), 400
        
        if Team.query.filter_by(name=team_name).first():
            return jsonify({'error': 'Team already exists'}), 400
        
        team = Team(name=team_name, owner=team_owner)
        db.session.add(team)
        db.session.commit()
        return jsonify(team.to_dict()), 201
    
    teams_list = Team.query.all()
    return jsonify([t.to_dict(include_players=True) for t in teams_list])


@app.route('/api/teams/<int:team_id>', methods=['GET', 'DELETE'])
def team_detail(team_id):
    team = Team.query.get_or_404(team_id)
    
    if request.method == 'DELETE':
        remove_all_team_logos(team.id)
        TeamLog.query.filter_by(team_id=team.id).delete(synchronize_session=False)
        db.session.delete(team)
        db.session.commit()
        reconcile_player_availability()
        return '', 204
    
    team_data = team.to_dict()
    team_data['players'] = [p.to_dict() for p in team.players]
    return jsonify(team_data)


@app.route('/api/teams/<int:team_id>/logo', methods=['POST'])
def upload_team_logo(team_id):
    team = Team.query.get_or_404(team_id)
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'No file provided'}), 400

    if not is_allowed_image(file.filename):
        return jsonify({'error': 'Invalid image format. Use png/jpg/jpeg/webp'}), 400

    ext = secure_filename(file.filename).rsplit('.', 1)[1].lower()
    logos_dir = app.config['TEAM_LOGOS_FOLDER']
    ensure_dir(logos_dir)

    remove_all_team_logos(team.id)

    filename = f'team_{team.id}.{ext}'
    save_path = os.path.join(logos_dir, filename)
    file.save(save_path)

    return jsonify({
        'message': 'Team logo updated successfully',
        'team': team.to_dict()
    }), 200


@app.route('/api/players', methods=['GET', 'POST'])
def players():
    if request.method == 'POST':
        data = request.get_json(silent=True)
        if isinstance(data, dict):
            if data and 'serial_number' not in data and ('name' in data or 'role' in data):
                return jsonify({'error': 'serial_number is required in JSON body'}), 400

            name = (data.get('name') or '').strip()
            role = (data.get('role') or '').strip() or 'Unknown'

            if 'serial_number' in data:
                if not name:
                    return jsonify({'error': 'name is required'}), 400
                try:
                    serial = int(data['serial_number'])
                except (TypeError, ValueError):
                    return jsonify({'error': 'serial_number must be an integer'}), 400

                if serial < 1:
                    return jsonify({'error': 'serial_number must be a positive integer'}), 400

                if Player.query.filter_by(serial_number=serial).first():
                    return jsonify({'error': f'Player with serial #{serial} already exists'}), 409

                player = Player(
                    serial_number=serial,
                    name=name,
                    role=role,
                    is_available=True
                )
                db.session.add(player)
                db.session.commit()
                return jsonify({'message': 'Player added', 'player': player.to_dict()}), 201

        return jsonify({'error': 'Send JSON with serial_number and name (Content-Type: application/json).'}), 400
    
    # Get available players
    available_only = request.args.get('available', 'false').lower() == 'true'
    if available_only:
        players_list = Player.query.filter_by(is_available=True).order_by(Player.serial_number.asc()).all()
    else:
        players_list = Player.query.order_by(Player.serial_number.asc()).all()
    
    return jsonify([p.to_dict() for p in players_list])


@app.route('/api/players/<int:player_id>', methods=['GET', 'DELETE'])
def player_detail(player_id):
    player = Player.query.get_or_404(player_id)
    
    if request.method == 'DELETE':
        db.session.delete(player)
        db.session.commit()
        return '', 204
    
    return jsonify(player.to_dict())


@app.route('/api/players/<int:player_id>/photo', methods=['POST'])
def upload_player_photo(player_id):
    player = Player.query.get_or_404(player_id)
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'No file provided'}), 400

    if not is_allowed_image(file.filename):
        return jsonify({'error': 'Invalid image format. Use png/jpg/jpeg/webp'}), 400

    ext = secure_filename(file.filename).rsplit('.', 1)[1].lower()
    photos_dir = app.config['PLAYER_PHOTOS_FOLDER']
    ensure_dir(photos_dir)
    filename = f'player_{player.serial_number}.{ext}'
    save_path = os.path.join(photos_dir, filename)
    file.save(save_path)

    player.photo_path = os.path.abspath(save_path)
    db.session.commit()

    return jsonify({
        'message': 'Player photo updated successfully',
        'player': player.to_dict()
    }), 200


@app.route('/api/auction', methods=['POST'])
def auction():
    data = request.json
    team_id = data.get('team_id')
    player_id = data.get('player_id')
    price = data.get('price', 1000)

    cleanup_orphan_bid_data()

    team = Team.query.get_or_404(team_id)
    player = Player.query.get_or_404(player_id)

    roster_row = AuctionedPlayer.query.filter_by(player_id=player.id).first()
    if roster_row:
        return jsonify({
            'error': 'Player is already on a team. Open Team View and remove them, or use Fix player pool / Clear all bids.'
        }), 400

    # Stale flag: no roster row but is_available stayed False (e.g. old team delete)
    if not player.is_available:
        player.is_available = True
        db.session.commit()

    # Validation
    available_budget = team.budget - sum(p.price for p in team.players)
    if price > available_budget:
        return jsonify({'error': f'Insufficient budget. Available: {available_budget}'}), 400
    
    if price < 1000:
        return jsonify({'error': 'Minimum bidding price is 1000'}), 400
    
    # Add player to team
    auctioned = AuctionedPlayer(
        team_id=team_id,
        player_id=player_id,
        price=price
    )
    player.is_available = False
    
    db.session.add(auctioned)
    add_team_log(team_id, player, 'BIDDED', price)
    db.session.commit()

    # Generate updated PDF report after every successful bid
    reports_dir = app.config['REPORTS_FOLDER']
    ensure_dir(reports_dir)
    report_path = os.path.join(reports_dir, 'team_players_latest.pdf')
    try:
        build_team_players_pdf(report_path)
    except Exception as pdf_error:
        print(f"PDF generation error: {pdf_error}")
    
    return jsonify({
        'message': f'{player.name} added to {team.name} for {price} points',
        'team': team.to_dict(),
        'auctioned_player': auctioned.to_dict(),
        'team_report_pdf_url': '/api/export/team-report-pdf'
    }), 201


@app.route('/api/auction/<int:auction_id>', methods=['DELETE'])
def remove_from_auction(auction_id):
    auctioned = AuctionedPlayer.query.get_or_404(auction_id)
    player = auctioned.player_ref
    team_id = auctioned.team_id
    price = auctioned.price
    
    player.is_available = True
    add_team_log(team_id, player, 'REMOVED', price)
    db.session.delete(auctioned)
    db.session.commit()
    
    return jsonify({'message': f'{player.name} removed from team'}), 200


@app.route('/api/auction/sync-availability', methods=['POST'])
def sync_auction_availability():
    """Remove bids tied to deleted teams, then fix Player.is_available flags."""
    removed_auctions, removed_logs = cleanup_orphan_bid_data()
    fixed = reconcile_player_availability()
    if removed_auctions or removed_logs:
        message = (
            f'Removed {removed_auctions} old bid link(s) and {removed_logs} log row(s) for deleted teams. '
            f'Updated {fixed} player status field(s).'
        )
    else:
        message = f'No orphan bids; updated {fixed} player status field(s).'
    return jsonify({
        'message': message,
        'orphan_auctions_removed': removed_auctions,
        'orphan_logs_removed': removed_logs,
        'players_updated': fixed
    }), 200


@app.route('/api/auction/reset', methods=['POST'])
def reset_auction_state():
    """Remove all auction assignments, clear bid logs, and return every player to the pool."""
    TeamLog.query.delete()
    AuctionedPlayer.query.delete()
    for player in Player.query.all():
        player.is_available = True
    db.session.commit()

    reports_dir = app.config['REPORTS_FOLDER']
    ensure_dir(reports_dir)
    report_path = os.path.join(reports_dir, 'team_players_latest.pdf')
    try:
        build_team_players_pdf(report_path)
    except Exception as pdf_error:
        print(f"PDF generation error after auction reset: {pdf_error}")

    return jsonify({
        'message': 'Auction cleared: all bids removed and every player is available again.',
        'players_returned': Player.query.count()
    }), 200


@app.route('/api/auction/<int:team_id>/<int:player_id>', methods=['DELETE'])
def remove_player_from_team(team_id, player_id):
    """Remove a player from a team (by team_id and player_id)"""
    auctioned = AuctionedPlayer.query.filter_by(
        team_id=team_id,
        player_id=player_id
    ).first_or_404()
    
    player = auctioned.player_ref
    price = auctioned.price
    
    # Mark player as available again
    player.is_available = True
    add_team_log(team_id, player, 'REMOVED', price)
    db.session.delete(auctioned)
    db.session.commit()
    
    return jsonify({'message': f'{player.name} removed from team. Budget refunded!'}), 200


@app.route('/api/dashboard')
def dashboard():
    teams = Team.query.all()
    total_players = Player.query.count()
    available_players = Player.query.filter_by(is_available=True).count()
    auctioned_players = Player.query.filter_by(is_available=False).count()
    
    teams_data = []
    for team in teams:
        total_spent = sum(p.price for p in team.players)
        teams_data.append({
            'name': team.name,
            'spent': total_spent,
            'available': team.budget - total_spent,
            'players': len(team.players)
        })
    
    return jsonify({
        'total_players': total_players,
        'available_players': available_players,
        'auctioned_players': auctioned_players,
        'teams': teams_data
    })


@app.route('/api/viewer/teams')
def viewer_teams():
    teams = Team.query.order_by(Team.name.asc()).all()
    data = []

    for team in teams:
        total_spent = sum(p.price for p in team.players)
        logo_filename = get_team_logo_filename(team.id)
        logo_url = team_logo_public_url(logo_filename) if logo_filename else None
        data.append({
            'id': team.id,
            'name': team.name,
            'owner': team.owner,
            'players_count': len(team.players),
            'total_spent': total_spent,
            'remaining_budget': team.budget - total_spent,
            'logo_url': logo_url
        })

    return jsonify(data)


@app.route('/api/viewer/teams/<int:team_id>')
def viewer_team_detail(team_id):
    team = Team.query.get_or_404(team_id)
    total_spent = sum(p.price for p in team.players)

    players = []
    for auctioned in team.players:
        p = auctioned.player_ref
        players.append({
            'id': p.id,
            'serial_number': p.serial_number,
            'name': p.name,
            'role': p.role,
            'photo_url': p.to_dict().get('photo_url'),
            'price': auctioned.price
        })

    players.sort(key=lambda item: item['serial_number'] or 0)
    logs = TeamLog.query.filter_by(team_id=team.id).order_by(TeamLog.created_at.desc()).limit(80).all()

    return jsonify({
        'id': team.id,
        'name': team.name,
        'owner': team.owner,
        'players_count': len(players),
        'total_spent': total_spent,
        'remaining_budget': team.budget - total_spent,
        'players': players,
        'logs': [log.to_dict() for log in logs]
    })


@app.route('/api/export', methods=['GET'])
def export_data():
    teams = Team.query.all()
    payload = {
        'exported_at': datetime.now().isoformat(),
        'teams': [],
        'available_players': []
    }

    for team in teams:
        spent = sum(p.price for p in team.players)
        roster = []
        for auctioned in team.players:
            p = auctioned.player_ref
            roster.append({
                'serial_number': p.serial_number,
                'name': p.name,
                'role': p.role,
                'price': auctioned.price,
            })
        payload['teams'].append({
            'name': team.name,
            'owner': team.owner,
            'budget': team.budget,
            'spent': spent,
            'available_budget': team.budget - spent,
            'players_count': len(team.players),
            'roster': roster,
        })

    for player in Player.query.filter_by(is_available=True).order_by(Player.serial_number.asc()).all():
        payload['available_players'].append({
            'serial_number': player.serial_number,
            'name': player.name,
            'role': player.role,
        })

    blob = json.dumps(payload, indent=2, ensure_ascii=False).encode('utf-8')
    output = BytesIO(blob)
    return send_file(
        output,
        mimetype='application/json',
        as_attachment=True,
        download_name=f'MPL_League_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    )


@app.route('/api/export/team-report-pdf', methods=['GET'])
def export_team_report_pdf():
    reports_dir = app.config['REPORTS_FOLDER']
    ensure_dir(reports_dir)
    report_path = os.path.join(reports_dir, 'team_players_latest.pdf')

    # Build on demand if not present
    if not os.path.exists(report_path):
        build_team_players_pdf(report_path)

    return send_file(
        report_path,
        mimetype='application/pdf',
        as_attachment=True,
        download_name='MPL_Team_Player_Report.pdf'
    )


@app.before_request
def add_predefined_teams():
    if not hasattr(app, 'predefined_teams_added'):
        db.create_all()
        print("Adding predefined teams...")
        predefined_teams = [
            {"name": "subbi friends", "owner": "pushpak"},
            {"name": "RCB boys", "owner": "bharath"},
            {"name": "avi boys", "owner": "anvesh"},
            {"name": "coconut boys", "owner": "anil"},
            {"name": "nethravathi enterprises", "owner": "chethan"}
        ]

        for team in predefined_teams:
            print(f"Checking team: {team['name']}")
            if not Team.query.filter_by(name=team['name']).first():
                print(f"Adding team: {team['name']}")
                db.session.add(Team(name=team['name'], owner=team['owner']))
            else:
                print(f"Team already exists: {team['name']}")
        db.session.commit()
        print("Predefined teams added.")
        app.predefined_teams_added = True

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=False)
