<?php
/**
 * Plugin Name: Kalendář akcí – ruční akce
 * Description: Ruční přidávání akcí do Kalendáře akcí ve Valašské Bystřici (varmuzaj-git.github.io/kalendar-vb). Akce se do kalendáře přenesou při nejbližší aktualizaci (3× denně). Obsahuje i shortcode [kalendar_akci] pro vložení kalendáře.
 * Version: 1.0.0
 * Author: Petr (ValachWeb)
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const KVB_PT       = 'kvb_akce';
const KVB_DATA_URL = 'https://varmuzaj-git.github.io/kalendar-vb/data/events.json';

/* ---------------------------------------------------------------------------
 * Typ obsahu „Akce do kalendáře“ (jen v administraci, na webu se nezobrazuje)
 * ------------------------------------------------------------------------- */
add_action( 'init', function () {
	register_post_type( KVB_PT, array(
		'labels'          => array(
			'name'               => 'Akce do kalendáře',
			'singular_name'      => 'Akce',
			'menu_name'          => 'Kalendář akcí',
			'add_new'            => 'Přidat akci',
			'add_new_item'       => 'Přidat akci do kalendáře',
			'edit_item'          => 'Upravit akci',
			'new_item'           => 'Nová akce',
			'all_items'          => 'Všechny akce',
			'search_items'       => 'Hledat akce',
			'not_found'          => 'Žádné akce',
			'not_found_in_trash' => 'V koši nejsou žádné akce',
			'featured_image'     => 'Plakát',
			'set_featured_image' => 'Nastavit plakát',
			'remove_featured_image' => 'Odebrat plakát',
		),
		'public'          => false,
		'show_ui'         => true,
		'show_in_menu'    => true,
		'show_in_rest'    => false,
		'menu_icon'       => 'dashicons-calendar-alt',
		'menu_position'   => 21,
		'supports'        => array( 'title', 'editor', 'thumbnail' ),
		'capability_type' => 'post',
	) );
} );

// klasický editor stačí (méně matoucí než bloky pro krátký popis)
add_filter( 'use_block_editor_for_post_type', function ( $use, $pt ) {
	return KVB_PT === $pt ? false : $use;
}, 10, 2 );

/** Pořadatelé a kategorie z kalendáře (cache 6 h), aby výběr odpovídal webu kalendáře. */
function kvb_lists() {
	$cached = get_transient( 'kvb_lists' );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$lists = array( 'organizers' => array(), 'categories' => array() );
	$res   = wp_remote_get( KVB_DATA_URL, array( 'timeout' => 10 ) );
	if ( ! is_wp_error( $res ) && 200 === wp_remote_retrieve_response_code( $res ) ) {
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		foreach ( (array) ( $data['organizers'] ?? array() ) as $o ) {
			$lists['organizers'][ sanitize_key( $o['id'] ) ] = sanitize_text_field( $o['name'] );
		}
		foreach ( (array) ( $data['categories'] ?? array() ) as $c ) {
			$lists['categories'][ sanitize_key( $c['id'] ) ] = sanitize_text_field( $c['label'] );
		}
	}
	if ( ! $lists['categories'] ) { // záloha, když GitHub zrovna neodpoví
		$lists['categories'] = array( 'kultura' => 'Kultura', 'sport' => 'Sport', 'deti' => 'Pro děti', 'seniori' => 'Senioři', 'vzdelavani' => 'Vzdělávání', 'obec' => 'Obec', 'cirkev' => 'Církev', 'ostatni' => 'Ostatní' );
	} else {
		set_transient( 'kvb_lists', $lists, 6 * HOUR_IN_SECONDS );
	}
	return $lists;
}

/* ---------------------------------------------------------------------------
 * Pole akce
 * ------------------------------------------------------------------------- */
const KVB_FIELDS = array( 'date_from', 'time_from', 'date_to', 'time_to', 'location', 'organizers', 'categories', 'tags', 'url' );

add_action( 'add_meta_boxes', function () {
	add_meta_box( 'kvb_detail', 'Termín, místo a pořadatel', 'kvb_render_box', KVB_PT, 'normal', 'high' );
} );

function kvb_get( $id, $key ) {
	return get_post_meta( $id, '_kvb_' . $key, true );
}

function kvb_render_box( $post ) {
	wp_nonce_field( 'kvb_save', 'kvb_nonce' );
	$v     = array();
	foreach ( KVB_FIELDS as $f ) {
		$v[ $f ] = kvb_get( $post->ID, $f );
	}
	$orgs  = (array) ( $v['organizers'] ?: array() );
	$cats  = (array) ( $v['categories'] ?: array() );
	$lists = kvb_lists();
	?>
	<style>
		.kvb-grid { display: grid; grid-template-columns: 160px 1fr; gap: 10px 14px; align-items: center; max-width: 760px; }
		.kvb-grid label.l { font-weight: 600; }
		.kvb-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
		.kvb-note { color: #646970; font-size: 12px; margin: 2px 0 0; }
		@media (max-width: 782px) { .kvb-grid { grid-template-columns: 1fr; } }
	</style>
	<div class="kvb-grid">
		<label class="l" for="kvb_date_from">Začátek *</label>
		<div>
			<input type="date" id="kvb_date_from" name="kvb[date_from]" value="<?php echo esc_attr( $v['date_from'] ); ?>" required>
			<input type="time" name="kvb[time_from]" value="<?php echo esc_attr( $v['time_from'] ); ?>" aria-label="Čas začátku">
			<p class="kvb-note">Bez času = celodenní akce.</p>
		</div>
		<label class="l" for="kvb_date_to">Konec</label>
		<div>
			<input type="date" id="kvb_date_to" name="kvb[date_to]" value="<?php echo esc_attr( $v['date_to'] ); ?>">
			<input type="time" name="kvb[time_to]" value="<?php echo esc_attr( $v['time_to'] ); ?>" aria-label="Čas konce">
			<p class="kvb-note">Nepovinné. Vícedenní akce: vyplňte datum konce.</p>
		</div>
		<label class="l" for="kvb_location">Místo</label>
		<input type="text" id="kvb_location" class="regular-text" name="kvb[location]" value="<?php echo esc_attr( $v['location'] ); ?>" placeholder="např. Společenský dům U Pernických">
		<span class="l">Pořadatel</span>
		<div class="kvb-checks">
			<?php foreach ( $lists['organizers'] as $id => $name ) : ?>
				<label><input type="checkbox" name="kvb[organizers][]" value="<?php echo esc_attr( $id ); ?>" <?php checked( in_array( $id, $orgs, true ) ); ?>> <?php echo esc_html( $name ); ?></label>
			<?php endforeach; ?>
			<?php if ( ! $lists['organizers'] ) : ?><em>Seznam pořadatelů se nepodařilo načíst, zkuste to později.</em><?php endif; ?>
		</div>
		<span class="l">Kategorie</span>
		<div class="kvb-checks">
			<?php foreach ( $lists['categories'] as $id => $name ) : ?>
				<label><input type="checkbox" name="kvb[categories][]" value="<?php echo esc_attr( $id ); ?>" <?php checked( in_array( $id, $cats, true ) ); ?>> <?php echo esc_html( $name ); ?></label>
			<?php endforeach; ?>
		</div>
		<label class="l" for="kvb_tags">Štítky</label>
		<div>
			<input type="text" id="kvb_tags" class="regular-text" name="kvb[tags]" value="<?php echo esc_attr( $v['tags'] ); ?>" placeholder="např. advent, Mikuláš">
			<p class="kvb-note">Oddělte čárkou. Nepovinné.</p>
		</div>
		<label class="l" for="kvb_url">Odkaz na akci</label>
		<input type="url" id="kvb_url" class="regular-text" name="kvb[url]" value="<?php echo esc_attr( $v['url'] ); ?>" placeholder="https://">
	</div>
	<p class="kvb-note" style="margin-top:12px">Plakát nahrajte vpravo v poli „Plakát“. Popis akce pište do editoru výše. Akce se v kalendáři objeví při nejbližší aktualizaci (3× denně).</p>
	<?php
}

add_action( 'save_post_' . KVB_PT, function ( $post_id ) {
	if ( ! isset( $_POST['kvb_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['kvb_nonce'] ) ), 'kvb_save' ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	$in    = isset( $_POST['kvb'] ) && is_array( $_POST['kvb'] ) ? wp_unslash( $_POST['kvb'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	$lists = kvb_lists();
	$date  = function ( $s ) { return preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $s ) ? $s : ''; };
	$time  = function ( $s ) { return preg_match( '/^\d{2}:\d{2}$/', (string) $s ) ? $s : ''; };
	$clean = array(
		'date_from'  => $date( $in['date_from'] ?? '' ),
		'time_from'  => $time( $in['time_from'] ?? '' ),
		'date_to'    => $date( $in['date_to'] ?? '' ),
		'time_to'    => $time( $in['time_to'] ?? '' ),
		'location'   => sanitize_text_field( $in['location'] ?? '' ),
		'organizers' => array_values( array_intersect( array_map( 'sanitize_key', (array) ( $in['organizers'] ?? array() ) ), array_keys( $lists['organizers'] ) ) ),
		'categories' => array_values( array_intersect( array_map( 'sanitize_key', (array) ( $in['categories'] ?? array() ) ), array_keys( $lists['categories'] ) ) ),
		'tags'       => sanitize_text_field( $in['tags'] ?? '' ),
		'url'        => esc_url_raw( $in['url'] ?? '' ),
	);
	foreach ( $clean as $k => $val ) {
		update_post_meta( $post_id, '_kvb_' . $k, $val );
	}
} );

/* Přehled akcí: sloupce Termín a Pořadatel, řazení podle termínu */
add_filter( 'manage_' . KVB_PT . '_posts_columns', function ( $cols ) {
	return array( 'cb' => $cols['cb'], 'title' => 'Akce', 'kvb_when' => 'Termín', 'kvb_org' => 'Pořadatel', 'date' => 'Vloženo' );
} );
add_action( 'manage_' . KVB_PT . '_posts_custom_column', function ( $col, $id ) {
	if ( 'kvb_when' === $col ) {
		$d = kvb_get( $id, 'date_from' );
		echo esc_html( $d ? date_i18n( 'j. n. Y', strtotime( $d ) ) . ' ' . kvb_get( $id, 'time_from' ) : '—' );
	} elseif ( 'kvb_org' === $col ) {
		$lists = kvb_lists();
		$names = array_map( function ( $o ) use ( $lists ) { return $lists['organizers'][ $o ] ?? $o; }, (array) ( kvb_get( $id, 'organizers' ) ?: array() ) );
		echo esc_html( $names ? implode( ', ', $names ) : '—' );
	}
}, 10, 2 );
add_filter( 'manage_edit-' . KVB_PT . '_sortable_columns', function ( $cols ) {
	$cols['kvb_when'] = 'kvb_when';
	return $cols;
} );
add_action( 'pre_get_posts', function ( $q ) {
	if ( ! is_admin() || ! $q->is_main_query() || KVB_PT !== $q->get( 'post_type' ) ) {
		return;
	}
	if ( ! $q->get( 'orderby' ) || 'kvb_when' === $q->get( 'orderby' ) ) {
		$q->set( 'meta_key', '_kvb_date_from' );
		$q->set( 'orderby', 'meta_value' );
		if ( ! $q->get( 'order' ) ) {
			$q->set( 'order', 'DESC' );
		}
	}
} );

/* ---------------------------------------------------------------------------
 * Veřejné JSON pro sběr akcí: /wp-json/kalendar-vb/v1/akce (jen publikované akce)
 * ------------------------------------------------------------------------- */
add_action( 'rest_api_init', function () {
	register_rest_route( 'kalendar-vb/v1', '/akce', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => function () {
			$posts = get_posts( array( 'post_type' => KVB_PT, 'post_status' => 'publish', 'numberposts' => 500, 'no_found_rows' => true ) );
			$out   = array();
			foreach ( $posts as $p ) {
				$from = kvb_get( $p->ID, 'date_from' );
				if ( ! $from ) {
					continue;
				}
				$img   = get_the_post_thumbnail_url( $p, 'large' );
				$out[] = array(
					'id'          => $p->ID,
					'modified'    => $p->post_modified_gmt,
					'title'       => html_entity_decode( get_the_title( $p ), ENT_QUOTES, 'UTF-8' ),
					'description' => trim( wp_strip_all_tags( $p->post_content ) ),
					'date_from'   => $from,
					'time_from'   => kvb_get( $p->ID, 'time_from' ),
					'date_to'     => kvb_get( $p->ID, 'date_to' ),
					'time_to'     => kvb_get( $p->ID, 'time_to' ),
					'location'    => kvb_get( $p->ID, 'location' ),
					'organizers'  => (array) ( kvb_get( $p->ID, 'organizers' ) ?: array() ),
					'categories'  => (array) ( kvb_get( $p->ID, 'categories' ) ?: array() ),
					'tags'        => array_values( array_filter( array_map( 'trim', explode( ',', (string) kvb_get( $p->ID, 'tags' ) ) ) ) ),
					'url'         => kvb_get( $p->ID, 'url' ),
					'image'       => $img ? $img : '',
				);
			}
			return rest_ensure_response( $out );
		},
	) );
} );

/* ---------------------------------------------------------------------------
 * Shortcode [kalendar_akci] – vložení kalendáře s automatickou výškou
 * ------------------------------------------------------------------------- */
if ( ! shortcode_exists( 'kalendar_akci' ) ) {
	add_shortcode( 'kalendar_akci', 'kvb_shortcode' );
}
function kvb_shortcode() {
	$src    = 'https://varmuzaj-git.github.io/kalendar-vb/?embed=1';
	$origin = 'https://varmuzaj-git.github.io';
	ob_start();
	?>
	<div class="kalendar-vb">
		<iframe id="kalendar-vb-frame" src="<?php echo esc_url( $src ); ?>" title="Kalendář akcí ve Valašské Bystřici" loading="lazy" style="width:100%;border:0;min-height:900px;display:block" scrolling="no"></iframe>
		<noscript><p><a href="<?php echo esc_url( $src ); ?>">Otevřít kalendář akcí</a></p></noscript>
	</div>
	<script>
	(function () {
		var f = document.getElementById('kalendar-vb-frame');
		window.addEventListener('message', function (e) {
			if (e.origin !== <?php echo wp_json_encode( $origin ); ?> || !e.data) return;
			if (e.data.type === 'kalendar-vb-height' && e.data.height > 0) f.style.height = (e.data.height + 4) + 'px';
			if (e.data.type === 'kalendar-vb-scroll') window.scrollTo({ top: f.getBoundingClientRect().top + window.scrollY + e.data.top - 10, behavior: 'smooth' });
		});
	})();
	</script>
	<?php
	return ob_get_clean();
}
