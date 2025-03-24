import QRCode from 'qrcode'

const urlParams = new URLSearchParams(window.location.search);

export const geoserver_address = urlParams.get("geoserver_address"); //"https://geoserver-admin.rest-gdi.geo-data.space";
export const namespace = urlParams.get("namespace"); //"invekos";
export const feature_wfs_name = namespace + ":" + urlParams.get("wfs_feature_name"); //"FT_INVEKOS_Schlaege_public_files";
export const file_wfs_name = namespace + ":" + urlParams.get("wfs_files_view"); //wfs_files_view
export const feature_id_property = urlParams.get("id_property"); //gml_identifier_public

export const popupAttributes = JSON.parse(urlParams.get("info_attrs"));
/*
[
  { "label": "Interne ID", "attrid": "fid" },
  { "label": "Förderart", "attrid": "foerderart" },
  { "label": "Förderart-URL", "attrid": "foerderart_url" },
  { "label": "Snar-Code", "attrid": "snar_code" },
  { "label": "Snar-Bezeichnung", "attrid": "snar_bezeichnung" },
  { "label": "Snar-URL", "attrid": "snar_url" },
  { "label": "Fläche Brutto", "attrid": "sl_flaeche_brutto" },
  { "label": "KG Nummer", "attrid": "kg_nummer" },
  { "label": "KG Name", "attrid": "kg_name" },
  { "label": "Gemeinde Nummer", "attrid": "gem_nummer" },
  { "label": "Gemeinde Name", "attrid": "gem_name" },
  { "label": "Bundesland", "attrid": "bundesland" },
  { "label": "Flurstück-Nutzungsart", "attrid": "flurstuecknutzungsart" },
  { "label": "Flurstück-Nutzungsart-URL", "attrid": "flurstuecknutzungsart_url" },
  { "label": "Besitzer", "attrid": "owner" }
]
  */


// export const geoserver_address = "https://geoserver.rest-gdi.geo-data.space";
// export const namespace = "invekos";
// export const feature_wfs_name = namespace + ":weinbauriede_bgl_view";
// export const file_wfs_name = namespace + ":weinbauriede_bgl_files_view";
// export const feature_id_property = "fid";


// <tr><td>Interne ID</td><td>${feature.get()}</td></tr>
// <tr><td>Riedname</td><td>${feature.get("riedname")}</td></tr>
// <tr><td>Eigentümer</td><td>${feature.get("owner")}</td></tr>
// <tr><td>Bezirk</td><td>${feature.get("bezname")}</td></tr>
// <tr><td>Gemeinde</td><td>${feature.get("gemname")}</td></tr>
// <tr><td>Katastralgemeinde</td><td>${feature.get("kgname")}</td></tr>
// <tr><td>Fläche m2</td><td>${feature.get("flache_m2")}</td></tr>
// `;

