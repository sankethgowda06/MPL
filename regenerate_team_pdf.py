import os

from app import app, build_team_players_pdf


def main():
    reports_dir = app.config['REPORTS_FOLDER']
    os.makedirs(reports_dir, exist_ok=True)
    output_path = os.path.join(reports_dir, 'team_players_latest.pdf')

    with app.app_context():
        build_team_players_pdf(output_path)

    print(f"Generated PDF: {output_path}")


if __name__ == "__main__":
    main()
