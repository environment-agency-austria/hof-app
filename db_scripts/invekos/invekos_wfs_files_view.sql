CREATE TABLE schlag_wfs_file_owner (
    fid int4 NOT NULL,
    username varchar(64) NOT NULL,
    "owner" bool NULL,
    CONSTRAINT schlag_wfs_file_owner_pkey PRIMARY KEY (fid, username)
);

CREATE TABLE schlag_wfs_files (
    fid serial4 NOT NULL,
    objectid varchar(255) NULL,
    filename varchar(255) NULL,
    filesize int4 NULL,
    mimetype varchar(128) NULL,
    fdata bytea NULL,
    CONSTRAINT schlag_wfs_files_pk PRIMARY KEY (fid)
);

CREATE OR REPLACE VIEW invekos_schlaege_2015_2024_view
AS SELECT ps.id,
    ps.geom,
    ps.fid,
    ps.dannr,
    ps.hauptbetriebsnummer,
    ps.teilbetriebsnummer,
    ps.bezirksbauernkammer,
    ps.foerderart,
    ps.flurstuecksnummer,
    ps.flurstuecksname,
    ps.flurstuecknutzungsart,
    ps.schlagnummer,
    ps.snar_code,
    ps.snar_bezeichnung,
    ps.laerchenwi,
    ps.beschirmt_jn,
    ps.code,
    ps.sorte,
    ps.begr_bez,
    ps.sl_auspfl,
    ps.sl_flaeche_brutto,
    ps.sl_fleache_netto,
    ps.kg_nummer,
    ps.kg_name,
    ps.gem_nummer,
    ps.gem_name,
    ps.bundesland,
    ps.schlag_id,
    ps.flurstueck_id,
    ps.ln_anteil,
    ps.bez_nummer,
    ps.bez_name,
    ps."beschirmteFlaecheProzent",
    ps.x_coor_centroid,
    ps.y_coor_centroid,
    ps.x_max,
    ps.x_min,
    ps.y_max,
    ps.y_min,
    ps."localId",
    ps.gml_identifier_governmental,
    ps.namespace_governmental,
    ps.gml_identifier_public,
    ps.namespace_public,
    ps."versionId",
    ps.snar_url,
    ps.foerderart_url,
    ps.flurstuecknutzungsart_url,
    ps.year,
    ps.owner
   FROM invekos_schlaege_2015_2024 ps
  WHERE ps.owner::text = current_setting('my.wfsuser'::text, true) OR current_setting('my.wfsuser'::text, true) = 'geoserver-admin'::text OR (EXISTS ( SELECT psfo.fid,
            psfo.username,
            psfo.owner,
            psf.fid,
            psf.objectid,
            psf.filename,
            psf.filesize,
            psf.mimetype,
            psf.fdata
           FROM schlag_wfs_file_owner psfo
             JOIN schlag_wfs_files psf ON psfo.fid = psf.fid
          WHERE psf.objectid::text = ps.gml_identifier_public::text AND (psfo.username::text = current_setting('my.wfsuser'::text, true) OR psfo.username::text = 'gast'::text)));


CREATE OR REPLACE VIEW /*schlag_*/wfs_files_view
AS SELECT psf.fid,
    psf.objectid,
    psf.filename,
    psf.filesize,
    psf.mimetype,
    ( SELECT string_agg(psfo2.username::text, ','::text) AS string_agg
           FROM schlag_wfs_file_owner psfo2
          WHERE psfo2.fid = psf.fid AND psfo.owner = true
          GROUP BY psfo2.fid) AS userids,
    encode(psf.fdata, 'base64'::text) AS fdata
   FROM schlag_wfs_files psf
     JOIN schlag_wfs_file_owner psfo ON psf.fid = psfo.fid
  WHERE psfo.username::text = current_setting('my.wfsuser'::text, true) OR current_setting('my.wfsuser'::text, true) = 'geoserver-admin'::text AND psfo.owner = true;
 

CREATE OR REPLACE FUNCTION schlag_wfs_files_view_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE NewFileId INTEGER;
DECLARE uid VARCHAR;
DECLARE parentOwner VARCHAR;
BEGIN
    INSERT INTO schlag_wfs_files (objectid, filename, filesize, mimetype, fdata)
    VALUES (
        NEW.objectid,
        NEW.filename,
        NEW.filesize,
        NEW.mimetype,
        decode(NEW.fdata, 'base64')  -- Convert back to bytea
    ) 
    RETURNING "fid" INTO NewFileId;

    -- patch in the newly assigned id and get rid of fdata, as it is too large for notify (and probably neo4j too)
    PERFORM pg_notify(('fileadd')::text, ((row_to_json(NEW)::jsonb-'fdata' || jsonb ('{"fid":' || NewFileId || '}') || jsonb('{"metadata": {"nodetype":"FT_Invekos_Schlaege_Version", "idAttr":"gml_identifier_public"}}'))::text));

    SELECT ps.owner INTO parentOwner FROM invekos_schlaege_2015_2024 ps WHERE ps.gml_identifier_public=NEW.objectid;

    FOREACH uid in array string_to_array(NEW.userids, ',')
    LOOP
        IF parentOwner <> uid THEN
            INSERT INTO schlag_wfs_file_owner VALUES (NewFileId, uid, False);
        END IF;
    END LOOP;

    INSERT INTO schlag_wfs_file_owner VALUES (NewFileId, parentOwner, True);

    IF parentOwner <> current_setting('my.wfsuser'::text, true) THEN
        INSERT INTO schlag_wfs_file_owner VALUES (NewFileId, current_setting('my.wfsuser'::text, true), True);
    END IF;
    
    RETURN NEW;  -- Optionally return the inserted row in the view format
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE EXCEPTION 'Foreign key constraint violation on psiteid';
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid view data: %', SQLERRM;
END;
$function$
;


CREATE OR REPLACE FUNCTION schlag_wfs_files_view_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM schlag_wfs_files WHERE fid = OLD.fid AND (current_setting('my.wfsuser')='admin' OR EXISTS (SELECT * FROM schlag_wfs_file_owner psfo WHERE psfo.fid=OLD.fid AND psfo.username=current_setting('my.wfsuser')));
    PERFORM pg_notify(CAST('filedel' AS text), (row_to_json(OLD)::jsonb-'fdata')::text);
    RETURN OLD;  -- Optionally return the deleted row in the view format
END;
$function$


create trigger schlag_wfs_files_view_delete_trigger instead of
delete
    on
    /*schlag_*/wfs_files_view for each row execute function schlag_wfs_files_view_delete()
    
create trigger schlag_wfs_files_view_insert_trigger instead of
insert
    on
    /*schlag_*/wfs_files_view for each row execute function schlag_wfs_files_view_insert()
