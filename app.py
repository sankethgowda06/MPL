from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from datetime import datetime
import os
import json
import csv
import re
import mimetypes
from io import BytesIO
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from werkzeug.utils import secure_filename
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors
from sqlalchemy.exc import OperationalError, IntegrityError
import time

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///mpl_league.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['PLAYER_PHOTOS_FOLDER'] = os.path.join(app.static_folder, 'player_photos')
app.config['TEAM_LOGOS_FOLDER'] = os.path.join(app.static_folder, 'team_logos')
app.config['REPORTS_FOLDER'] = 'reports'

ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
PHOTO_DOWNLOAD_TIMEOUT_SECONDS = 6

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
        photo_url = None
        photo_filename = None
        if self.photo_path:
            photo_filename = os.path.basename(self.photo_path)
            photo_url = player_photo_public_url(photo_filename)
        
        return {
            'id': self.id,
            'serial_number': self.serial_number,
            'name': self.name,
            'role': self.role,
            'photo_path': photo_filename,
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
    return f"{app.static_url_path.rstrip('/')}/team_logos/{logo_filename}?v={v}"


def player_photo_public_url(photo_path):
    if not photo_path:
        return None
    photo_filename = os.path.basename(photo_path)
    return f"{app.static_url_path.rstrip('/')}/player_photos/{photo_filename}"


def resolve_player_photo_path(photo_path):
    if not photo_path:
        return None
    if os.path.isabs(photo_path) and os.path.exists(photo_path):
        return photo_path
    photo_filename = os.path.basename(photo_path)
    return os.path.join(app.config['PLAYER_PHOTOS_FOLDER'], photo_filename)


def clear_all_player_photos():
    photos_dir = app.config['PLAYER_PHOTOS_FOLDER']
    ensure_dir(photos_dir)
    removed = 0
    for name in os.listdir(photos_dir):
        path = os.path.join(photos_dir, name)
        if os.path.isfile(path):
            try:
                os.remove(path)
                removed += 1
            except OSError:
                continue
    return removed


def normalize_header_name(value):
    cleaned = re.sub(r'[^a-z0-9]+', ' ', (value or '').strip().lower())
    return re.sub(r'\s+', ' ', cleaned).strip()


def find_matching_column(headers_map, candidates):
    for candidate in candidates:
        if candidate in headers_map:
            return headers_map[candidate]
    for normalized_header, original_header in headers_map.items():
        for candidate in candidates:
            if candidate in normalized_header:
                return original_header
    return None


def google_sheet_csv_url(sheet_url):
    parsed = urlparse((sheet_url or '').strip())
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Provide a valid Google Sheet URL.')

    host = parsed.netloc.lower()
    if 'docs.google.com' not in host:
        raise ValueError('Only Google Sheet links are supported.')

    path = parsed.path
    query = parse_qs(parsed.query)

    # If user already provided CSV export URL, use it directly.
    if path.endswith('/export') and query.get('format', [''])[0].lower() == 'csv':
        return sheet_url

    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', path)
    if not match:
        raise ValueError('Could not detect Google Sheet ID from URL.')

    sheet_id = match.group(1)
    gid = query.get('gid', [None])[0]

    if not gid and parsed.fragment:
        fragment_qs = parse_qs(parsed.fragment.replace('#', ''))
        gid = fragment_qs.get('gid', [None])[0]
        if not gid:
            gid_match = re.search(r'gid=([0-9]+)', parsed.fragment)
            if gid_match:
                gid = gid_match.group(1)

    if gid:
        return f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}'
    return f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv'


def parse_google_drive_file_id(url):
    parsed = urlparse((url or '').strip())
    if not parsed.netloc:
        return None

    query = parse_qs(parsed.query)
    if 'id' in query and query['id']:
        return query['id'][0]

    match = re.search(r'/file/d/([a-zA-Z0-9_-]+)', parsed.path)
    if match:
        return match.group(1)
    return None


def resolve_photo_download_url(photo_url):
    parsed = urlparse((photo_url or '').strip())
    host = parsed.netloc.lower()
    if 'drive.google.com' in host:
        file_id = parse_google_drive_file_id(photo_url)
        if file_id:
            return f'https://drive.google.com/uc?export=download&id={file_id}'
    return photo_url


def download_player_photo(photo_url, serial):
    if not photo_url:
        return None

    source_url = resolve_photo_download_url(photo_url)
    req = Request(source_url, headers={'User-Agent': 'Mozilla/5.0'})

    try:
        with urlopen(req, timeout=PHOTO_DOWNLOAD_TIMEOUT_SECONDS) as resp:
            content_type = (resp.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            payload = resp.read(3 * 1024 * 1024 + 1)  # Cap at ~3MB
    except Exception:
        return None

    if len(payload) == 0 or len(payload) > 3 * 1024 * 1024:
        return None

    ext = None
    if content_type:
        guessed = mimetypes.guess_extension(content_type) or ''
        ext = guessed.replace('.', '').lower() if guessed else None

    if not ext:
        parsed = urlparse(source_url)
        basename = os.path.basename(parsed.path)
        if '.' in basename:
            ext = basename.rsplit('.', 1)[1].lower()

    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return None

    filename = f'player_{serial}.{ext}'
    save_path = os.path.join(app.config['PLAYER_PHOTOS_FOLDER'], filename)
    with open(save_path, 'wb') as f:
        f.write(payload)
    return filename


def import_players_from_google_sheet(sheet_url, include_photos=True):
    csv_url = google_sheet_csv_url(sheet_url)
    req = Request(csv_url, headers={'User-Agent': 'Mozilla/5.0'})

    try:
        with urlopen(req, timeout=20) as resp:
            content = resp.read().decode('utf-8-sig', errors='replace')
    except (HTTPError, URLError) as exc:
        raise ValueError(f'Failed to fetch sheet data: {exc}')

    rows = list(csv.DictReader(content.splitlines()))
    if not rows:
        return {
            'imported': 0,
            'skipped': 0,
            'photos_saved': 0,
            'csv_url': csv_url,
        }

    headers_map = {normalize_header_name(k): k for k in (rows[0].keys() if rows[0] else [])}
    name_col = find_matching_column(headers_map, ['player name', 'name'])
    role_col = find_matching_column(headers_map, ['player role', 'role'])
    photo_col = find_matching_column(headers_map, ['player photo', 'photo'])

    if not name_col:
        raise ValueError('Could not find "Player name" column in the sheet.')

    existing_keys = {
        ((p.name or '').strip().lower(), (p.role or '').strip().lower())
        for p in Player.query.all()
    }
    existing_players = {
        ((p.name or '').strip().lower(), (p.role or '').strip().lower()): p
        for p in Player.query.all()
    }
    used_serials = {
        p.serial_number
        for p in Player.query.all()
        if isinstance(p.serial_number, int) and p.serial_number > 0
    }

    imported = 0
    skipped = 0
    photos_saved = 0

    def commit_with_retry(max_attempts=4, base_delay=0.3):
        for attempt in range(max_attempts):
            try:
                db.session.commit()
                return
            except OperationalError as exc:
                db.session.rollback()
                is_locked = 'database is locked' in str(exc).lower()
                if is_locked and attempt < max_attempts - 1:
                    time.sleep(base_delay * (attempt + 1))
                    continue
                raise

    def allocate_next_serial():
        serial = 1
        while serial in used_serials:
            serial += 1
        used_serials.add(serial)
        return serial

    for row in rows:
        name = (row.get(name_col) or '').strip()
        role = (row.get(role_col) or '').strip() if role_col else ''
        photo_url = (row.get(photo_col) or '').strip() if photo_col else ''

        if not name:
            skipped += 1
            continue

        role = role or 'Unknown'
        dedupe_key = (name.lower(), role.lower())
        if dedupe_key in existing_keys:
            if include_photos and photo_url:
                existing_player = existing_players.get(dedupe_key)
                if existing_player and not existing_player.photo_path and existing_player.serial_number:
                    photo_filename = download_player_photo(photo_url, existing_player.serial_number)
                    if photo_filename:
                        existing_player.photo_path = photo_filename
                        try:
                            commit_with_retry()
                            photos_saved += 1
                        except Exception:
                            db.session.rollback()
            skipped += 1
            continue

        serial = allocate_next_serial()
        player = Player(
            serial_number=serial,
            name=name,
            role=role,
            is_available=True,
        )

        photo_filename = None
        if include_photos and photo_url:
            photo_filename = download_player_photo(photo_url, serial)
            if photo_filename:
                player.photo_path = photo_filename

        db.session.add(player)
        try:
            commit_with_retry()
            existing_keys.add(dedupe_key)
            existing_players[dedupe_key] = player
            imported += 1
            if photo_filename:
                photos_saved += 1
        except IntegrityError:
            db.session.rollback()
            skipped += 1
            if photo_filename:
                photo_path = os.path.join(app.config['PLAYER_PHOTOS_FOLDER'], photo_filename)
                if os.path.exists(photo_path):
                    os.remove(photo_path)
        except OperationalError as exc:
            db.session.rollback()
            skipped += 1
            if photo_filename:
                photo_path = os.path.join(app.config['PLAYER_PHOTOS_FOLDER'], photo_filename)
                if os.path.exists(photo_path):
                    os.remove(photo_path)
            print(f'Import row skipped due to DB error: {exc}')
        except Exception:
            db.session.rollback()
            skipped += 1
            if photo_filename:
                photo_path = os.path.join(app.config['PLAYER_PHOTOS_FOLDER'], photo_filename)
                if os.path.exists(photo_path):
                    os.remove(photo_path)
            print(f'Import row skipped due to unexpected error for player: {name}')

    return {
        'imported': imported,
        'skipped': skipped,
        'photos_saved': photos_saved,
        'csv_url': csv_url,
    }


# Ensure static upload folders exist on app startup.
ensure_dir(app.config['PLAYER_PHOTOS_FOLDER'])
ensure_dir(app.config['TEAM_LOGOS_FOLDER'])


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


def next_available_player_serial():
    """Return the smallest available positive serial (fills gaps after deletes)."""
    serial_rows = db.session.query(Player.serial_number).filter(Player.serial_number.isnot(None)).order_by(Player.serial_number.asc()).all()
    expected = 1
    for row in serial_rows:
        serial = row[0]
        if serial is None:
            continue
        if serial < expected:
            continue
        if serial > expected:
            return expected
        expected += 1
    return expected


def compact_player_serial_numbers():
    """Reassign serial numbers to a continuous 1..N sequence."""
    players = Player.query.order_by(Player.serial_number.asc(), Player.id.asc()).all()
    if not players:
        return 0

    # Two-pass update avoids unique collisions while renumbering.
    temp_base = 1_000_000
    changed = 0
    for idx, player in enumerate(players, start=1):
        temp_serial = temp_base + idx
        if player.serial_number != temp_serial:
            player.serial_number = temp_serial
            changed += 1
    db.session.commit()

    for idx, player in enumerate(players, start=1):
        if player.serial_number != idx:
            player.serial_number = idx
    db.session.commit()
    return changed


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


def fit_pdf_text(pdf, text, font_name, font_size, max_width):
    value = str(text or '')
    if pdf.stringWidth(value, font_name, font_size) <= max_width:
        return value

    suffix = '...'
    while value:
        value = value[:-1]
        candidate = value.rstrip() + suffix
        if pdf.stringWidth(candidate, font_name, font_size) <= max_width:
            return candidate
    return suffix


def bid_report_cache_dir():
    reports_dir = app.config['REPORTS_FOLDER']
    ensure_dir(reports_dir)
    bid_dir = os.path.join(reports_dir, 'bid_reports')
    ensure_dir(bid_dir)
    return bid_dir


def bid_report_cache_path(auctioned):
    safe_player = secure_filename(auctioned.player_ref.name or 'player')
    safe_team = secure_filename(auctioned.team.name or 'team')
    filename = f'bid_{auctioned.id}_{safe_player}_{safe_team}.pdf'
    return os.path.join(bid_report_cache_dir(), filename)


def save_bid_receipt_pdf(auctioned, output_path=None):
    path = output_path or bid_report_cache_path(auctioned)
    pdf_stream = build_bid_receipt_pdf(auctioned)
    with open(path, 'wb') as handle:
        handle.write(pdf_stream.getvalue())
    return path


def build_team_players_pdf(output_path):
    teams = Team.query.order_by(Team.name.asc()).all()
    page_width, page_height = A4
    pdf = canvas.Canvas(output_path, pagesize=A4)

    margin_x = 24
    content_width = page_width - (2 * margin_x)

    card_w = content_width
    card_h = 108
    photo_w = 72
    photo_h = 90
    row_gap = 10

    def draw_page_header():
        y_top = page_height - 24
        header_h = 38
        pdf.setFillColor(colors.HexColor("#0F172A"))
        pdf.roundRect(margin_x, y_top - header_h, content_width, header_h, 10, stroke=0, fill=1)

        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 15)
        pdf.drawString(margin_x + 12, y_top - 16, "MPL Team Player Report")
        pdf.setFont("Helvetica", 8.8)
        pdf.drawRightString(
            margin_x + content_width - 12,
            y_top - 16,
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        return y_top - header_h - 10

    def draw_team_header(team_name, owner_name, players_count, spent_amount, remaining_amount, continued=False):
        bar_h = 26
        subtitle_h = 18
        section_h = bar_h + subtitle_h
        section_y = y - section_h

        pdf.setFillColor(colors.HexColor("#1E3A8A"))
        pdf.roundRect(margin_x, section_y + subtitle_h, content_width, bar_h, 7, stroke=0, fill=1)

        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 11)
        team_title = f"TEAM: {team_name.upper()}"
        if continued:
            team_title += " (CONT.)"
        pdf.drawString(margin_x + 10, section_y + subtitle_h + 9, fit_pdf_text(pdf, team_title, 'Helvetica-Bold', 11, content_width * 0.58))

        stats_text = f"Players: {players_count}   Spent: Rs. {spent_amount:,}   Left: Rs. {remaining_amount:,}"
        pdf.setFont("Helvetica", 9)
        pdf.drawRightString(margin_x + content_width - 10, section_y + subtitle_h + 9, fit_pdf_text(pdf, stats_text, 'Helvetica', 9, content_width * 0.38))

        pdf.setFillColor(colors.HexColor("#334155"))
        pdf.setFont("Helvetica", 8.8)
        owner_text = f"Owner: {owner_name or '-'}"
        pdf.drawString(margin_x + 2, section_y + 5, fit_pdf_text(pdf, owner_text, 'Helvetica', 8.8, content_width - 4))

        return section_y - 6

    pdf.setTitle("MPL Team Player List")
    y = draw_page_header()

    for team in teams:
        team_players = sorted(team.players, key=lambda a: a.player_ref.serial_number or 0)
        spent = sum(p.price for p in team.players)
        remaining = team.budget - spent

        if y < 120:
            pdf.showPage()
            y = draw_page_header()

        y = draw_team_header(team.name, team.owner, len(team_players), spent, remaining)

        if not team_players:
            pdf.setFont("Helvetica-Oblique", 9)
            pdf.setFillColor(colors.HexColor("#64748B"))
            pdf.drawString(margin_x + 4, y - 4, "No players bidded yet.")
            y -= 22
            continue

        for auctioned in team_players:
            if y < (card_h + 24):
                pdf.showPage()
                y = draw_page_header()
                y = draw_team_header(team.name, team.owner, len(team_players), spent, remaining, continued=True)

            card_x = margin_x
            card_y = y - card_h
            player = auctioned.player_ref
            photo_file_path = resolve_player_photo_path(player.photo_path)

            # Card background
            pdf.setFillColor(colors.HexColor("#F8FAFC"))
            pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
            pdf.roundRect(card_x, card_y, card_w, card_h, 10, stroke=1, fill=1)
            pdf.setFillColor(colors.black)

            # Photo block
            photo_x = card_x + 12
            photo_y = card_y + (card_h - photo_h) / 2
            pdf.setFillColor(colors.white)
            pdf.setStrokeColor(colors.HexColor("#D1D9E6"))
            pdf.roundRect(photo_x - 2, photo_y - 2, photo_w + 4, photo_h + 4, 6, stroke=1, fill=1)

            if photo_file_path and os.path.exists(photo_file_path):
                try:
                    img = ImageReader(photo_file_path)
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
                    pdf.roundRect(photo_x, photo_y, photo_w, photo_h, 4, stroke=1, fill=0)
                    pdf.setFont("Helvetica", 8)
                    pdf.setFillColor(colors.HexColor("#64748B"))
                    pdf.drawCentredString(photo_x + (photo_w / 2), photo_y + (photo_h / 2), "No Photo")
            else:
                pdf.setStrokeColor(colors.HexColor("#94A3B8"))
                pdf.roundRect(photo_x, photo_y, photo_w, photo_h, 4, stroke=1, fill=0)
                pdf.setFont("Helvetica", 8)
                pdf.setFillColor(colors.HexColor("#64748B"))
                pdf.drawCentredString(photo_x + (photo_w / 2), photo_y + (photo_h / 2), "No Photo")

            text_x = photo_x + photo_w + 16
            text_width = card_w - (text_x - card_x) - 14
            title_y = card_y + card_h - 20

            pdf.setFillColor(colors.HexColor("#0F172A"))
            pdf.setFont("Helvetica-Bold", 12)
            player_heading = fit_pdf_text(pdf, f"#{player.serial_number} {player.name}", 'Helvetica-Bold', 12, text_width)
            pdf.drawString(text_x, title_y, player_heading)

            # Role chip
            role_chip = fit_pdf_text(pdf, player.role, 'Helvetica-Bold', 8.5, 160)
            chip_w = min(max(pdf.stringWidth(role_chip, "Helvetica-Bold", 8.5) + 16, 58), 180)
            chip_y = title_y - 18
            pdf.setFillColor(colors.HexColor("#E2E8F0"))
            pdf.roundRect(text_x, chip_y - 7, chip_w, 15, 5, stroke=0, fill=1)
            pdf.setFillColor(colors.HexColor("#334155"))
            pdf.setFont("Helvetica-Bold", 8.5)
            pdf.drawString(text_x + 8, chip_y - 2, role_chip)

            row_label_w = 56
            row_y = chip_y - 22
            rows = [
                ("Bid", f"Rs. {auctioned.price:,}"),
                ("Time", auctioned.auctioned_at.strftime('%d-%m-%Y %I:%M %p')),
            ]
            pdf.setFont("Helvetica-Bold", 8.5)
            for label, value in rows:
                pdf.setFillColor(colors.HexColor("#64748B"))
                pdf.drawString(text_x, row_y, f"{label}:")
                pdf.setFillColor(colors.HexColor("#334155"))
                pdf.setFont("Helvetica", 9)
                safe_value = fit_pdf_text(pdf, value, 'Helvetica', 9, text_width - row_label_w)
                pdf.drawString(text_x + row_label_w, row_y, safe_value)
                pdf.setFont("Helvetica-Bold", 8.5)
                row_y -= 16

            y -= (card_h + row_gap)

        y -= 8

    pdf.save()


def build_bid_receipt_pdf(auctioned):
    player = auctioned.player_ref
    team = auctioned.team
    page_width, page_height = A4
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4)

    pdf.setTitle(f"MPL Bid Report - {player.name}")

    margin_x = 42
    content_w = page_width - (margin_x * 2)
    top_y = page_height - 48

    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.roundRect(margin_x, top_y - 82, content_w, 82, 16, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 23)
    pdf.drawString(margin_x + 18, top_y - 30, "MPL Auction Bid Report")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(margin_x + 18, top_y - 50, f"Generated: {datetime.now().strftime('%d-%m-%Y %I:%M %p')}")
    pdf.setFillColor(colors.HexColor("#FBBF24"))
    pdf.roundRect(margin_x + content_w - 110, top_y - 60, 92, 28, 10, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#111827"))
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawCentredString(margin_x + content_w - 64, top_y - 43, "SOLD")

    card_y = top_y - 360
    card_h = 250
    pdf.setFillColor(colors.HexColor("#F8FAFC"))
    pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
    pdf.roundRect(margin_x, card_y, content_w, card_h, 18, stroke=1, fill=1)

    photo_x = margin_x + 20
    photo_y = card_y + 22
    photo_w = 175
    photo_h = 205
    photo_file_path = resolve_player_photo_path(player.photo_path)

    pdf.setFillColor(colors.white)
    pdf.roundRect(photo_x - 6, photo_y - 6, photo_w + 12, photo_h + 12, 12, stroke=0, fill=1)
    pdf.setStrokeColor(colors.HexColor("#CBD5E1"))
    pdf.roundRect(photo_x - 6, photo_y - 6, photo_w + 12, photo_h + 12, 12, stroke=1, fill=0)

    if photo_file_path and os.path.exists(photo_file_path):
        try:
            img = ImageReader(photo_file_path)
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
            pdf.roundRect(photo_x, photo_y, photo_w, photo_h, 8, stroke=1, fill=0)
            pdf.setFont("Helvetica-Bold", 16)
            pdf.setFillColor(colors.HexColor("#64748B"))
            pdf.drawCentredString(photo_x + (photo_w / 2), photo_y + 90, "PLAYER PHOTO")
    else:
        pdf.setStrokeColor(colors.HexColor("#94A3B8"))
        pdf.roundRect(photo_x, photo_y, photo_w, photo_h, 8, stroke=1, fill=0)
        pdf.setFont("Helvetica-Bold", 16)
        pdf.setFillColor(colors.HexColor("#64748B"))
        pdf.drawCentredString(photo_x + (photo_w / 2), photo_y + 90, "PLAYER PHOTO")

    detail_x = photo_x + photo_w + 34
    detail_w = margin_x + content_w - detail_x - 20
    text_top = card_y + card_h - 28
    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.setFont("Helvetica-Bold", 22)
    player_name = fit_pdf_text(pdf, player.name, 'Helvetica-Bold', 22, detail_w)
    pdf.drawString(detail_x, text_top, player_name)

    pdf.setFillColor(colors.HexColor("#DBEAFE"))
    pdf.roundRect(detail_x, text_top - 36, min(detail_w, 170), 22, 8, stroke=0, fill=1)
    pdf.setFont("Helvetica-Bold", 12)
    pdf.setFillColor(colors.HexColor("#1D4ED8"))
    team_name = fit_pdf_text(pdf, team.name, 'Helvetica-Bold', 12, min(detail_w, 156))
    pdf.drawString(detail_x + 10, text_top - 22, team_name)

    row_y = text_top - 64
    row_h = 26
    label_w = 88
    rows = [
        ("Serial Number", f"#{player.serial_number}"),
        ("Role", player.role),
        ("Owner", team.owner),
        ("Time", auctioned.auctioned_at.strftime('%d-%m-%Y %I:%M %p')),
    ]

    for label, value in rows:
        pdf.setFillColor(colors.white)
        pdf.roundRect(detail_x, row_y - 16, detail_w, row_h, 8, stroke=0, fill=1)
        pdf.setStrokeColor(colors.HexColor("#E2E8F0"))
        pdf.roundRect(detail_x, row_y - 16, detail_w, row_h, 8, stroke=1, fill=0)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColor(colors.HexColor("#64748B"))
        pdf.drawString(detail_x + 10, row_y, label)
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.HexColor("#0F172A"))
        safe_value = fit_pdf_text(pdf, value, 'Helvetica', 10, detail_w - label_w - 18)
        pdf.drawRightString(detail_x + detail_w - 10, row_y, safe_value)
        row_y -= 34

    pdf.setFillColor(colors.HexColor("#16A34A"))
    pdf.roundRect(detail_x, card_y + 26, detail_w, 40, 12, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawCentredString(detail_x + (detail_w / 2), card_y + 41, f"Sold For: Rs. {auctioned.price:,}")

    pdf.setFillColor(colors.HexColor("#7C2D12"))
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(margin_x, card_y - 28, f"Bid completed at {auctioned.auctioned_at.strftime('%d-%m-%Y %I:%M %p')}")

    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(colors.HexColor("#475569"))
    pdf.drawString(margin_x, card_y - 50, "This report was generated automatically after the completed auction action.")

    pdf.save()
    output.seek(0)
    return output

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
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'error': 'Send JSON body (Content-Type: application/json).'}), 400

        name = (data.get('name') or '').strip()
        role = (data.get('role') or '').strip() or 'Unknown'
        if not name:
            return jsonify({'error': 'name is required'}), 400

        serial_raw = data.get('serial_number', None)
        if serial_raw in (None, ''):
            serial = next_available_player_serial()
        else:
            try:
                serial = int(serial_raw)
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
        return jsonify({'message': f'Player added as serial #{serial}', 'player': player.to_dict()}), 201
    
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
        AuctionedPlayer.query.filter_by(player_id=player.id).delete(synchronize_session=False)
        TeamLog.query.filter_by(player_id=player.id).delete(synchronize_session=False)
        db.session.delete(player)
        db.session.commit()
        compact_player_serial_numbers()
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

    player.photo_path = filename
    db.session.commit()

    return jsonify({
        'message': 'Player photo updated successfully',
        'player': player.to_dict()
    }), 200


@app.route('/api/players/import/google-sheet', methods=['POST'])
def import_players_google_sheet():
    data = request.get_json(silent=True) or {}
    sheet_url = (data.get('sheet_url') or '').strip()
    include_photos = bool(data.get('include_photos', True))

    if not sheet_url:
        return jsonify({'error': 'sheet_url is required'}), 400

    try:
        result = import_players_from_google_sheet(sheet_url, include_photos=include_photos)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception:
        return jsonify({'error': 'Unexpected error during sheet import.'}), 500

    return jsonify({
        'message': f"Imported {result['imported']} player(s). Skipped {result['skipped']} duplicate/empty row(s).",
        **result,
    }), 200


@app.route('/api/players/delete-all', methods=['POST'])
def delete_all_players():
    players_count = Player.query.count()
    auctions_count = AuctionedPlayer.query.count()
    logs_count = TeamLog.query.count()

    AuctionedPlayer.query.delete(synchronize_session=False)
    TeamLog.query.delete(synchronize_session=False)
    Player.query.delete(synchronize_session=False)
    photos_removed = clear_all_player_photos()
    db.session.commit()

    return jsonify({
        'message': 'All players deleted successfully.',
        'players_deleted': players_count,
        'auctions_deleted': auctions_count,
        'logs_deleted': logs_count,
        'photos_deleted': photos_removed,
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

    try:
        save_bid_receipt_pdf(auctioned)
    except Exception as pdf_error:
        print(f"Bid PDF cache error: {pdf_error}")
    
    return jsonify({
        'message': f'{player.name} added to {team.name} for {price} points',
        'team': team.to_dict(),
        'auctioned_player': auctioned.to_dict(),
        'team_report_pdf_url': '/api/export/team-report-pdf',
        'bid_report_pdf_url': f'/api/export/bid-report/{auctioned.id}'
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
    SyncService.sync_dashboard()

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


@app.route('/api/insights')
def insights():
    teams = Team.query.all()
    players = Player.query.all()
    auction_rows = AuctionedPlayer.query.all()

    total_auction_amount = sum(row.price for row in auction_rows)
    total_slots = max(len(teams) * 15, 1)
    sold_count = len(auction_rows)
    sold_percentage = round((sold_count / total_slots) * 100, 2)

    role_breakdown = {}
    unsold_by_role = {}
    for player in players:
        role = (player.role or 'Unknown').strip() or 'Unknown'
        role_breakdown.setdefault(role, {'sold': 0, 'unsold': 0})
        if player.is_available:
            role_breakdown[role]['unsold'] += 1
            unsold_by_role[role] = unsold_by_role.get(role, 0) + 1
        else:
            role_breakdown[role]['sold'] += 1

    highest_bid = None
    if auction_rows:
        top_row = max(auction_rows, key=lambda x: x.price)
        highest_bid = {
            'player_name': top_row.player_ref.name,
            'team_name': top_row.team.name,
            'price': top_row.price,
        }

    teams_summary = []
    for team in teams:
        spent = sum(p.price for p in team.players)
        teams_summary.append({
            'id': team.id,
            'name': team.name,
            'owner': team.owner,
            'players_count': len(team.players),
            'spent': spent,
            'remaining_budget': team.budget - spent,
            'avg_bid': round(spent / len(team.players), 2) if team.players else 0,
        })

    teams_summary.sort(key=lambda item: (-item['players_count'], item['remaining_budget']))

    return jsonify({
        'overview': {
            'teams_count': len(teams),
            'players_count': len(players),
            'sold_players': sold_count,
            'unsold_players': len(players) - sold_count,
            'sold_percentage_of_total_slots': sold_percentage,
            'total_auction_amount': total_auction_amount,
            'highest_bid': highest_bid,
        },
        'role_breakdown': role_breakdown,
        'unsold_by_role': unsold_by_role,
        'teams_summary': teams_summary,
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


@app.route('/api/viewer/players')
def viewer_players():
    """All players for the public viewer: roster status and bid price when sold."""
    players_list = Player.query.order_by(Player.serial_number.asc()).all()
    data = []
    for p in players_list:
        base = p.to_dict()
        item = {
            'id': base['id'],
            'serial_number': base['serial_number'],
            'name': base['name'],
            'role': base['role'],
            'photo_url': base.get('photo_url'),
            'team_name': None,
            'price': None,
        }
        auctioned = AuctionedPlayer.query.filter_by(player_id=p.id).first()
        if auctioned and auctioned.team:
            item['team_name'] = auctioned.team.name
            item['price'] = auctioned.price
        data.append(item)
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

    # Rebuild on every request so data and design are always current.
    build_team_players_pdf(report_path)

    return send_file(
        report_path,
        mimetype='application/pdf',
        as_attachment=True,
        download_name='MPL_Team_Player_Report.pdf'
    )


@app.route('/api/export/bid-report/<int:auction_id>', methods=['GET'])
def export_bid_report_pdf(auction_id):
    auctioned = AuctionedPlayer.query.get_or_404(auction_id)
    cached_path = bid_report_cache_path(auctioned)
    if not os.path.exists(cached_path):
        cached_path = save_bid_receipt_pdf(auctioned, cached_path)
    download_name = secure_filename(f"{auctioned.player_ref.name}_{auctioned.team.name}_bid_report.pdf")

    return send_file(
        cached_path,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=download_name
    )


@app.before_request
def add_predefined_teams():
    if not hasattr(app, 'schema_ready'):
        db.create_all()
        app.schema_ready = True

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=False)







