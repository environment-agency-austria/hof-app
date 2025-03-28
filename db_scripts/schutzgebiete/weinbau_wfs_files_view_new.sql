CREATE TABLE weinried_wfs_file_owner (
    fid int4 NOT NULL,
    username varchar(64) NOT NULL,
    "owner" bool NULL,
    CONSTRAINT weinried_wfs_file_owner_pkey PRIMARY KEY (fid, username)
);

CREATE TABLE weinried_wfs_files (
    fid serial4 NOT NULL,
    objectid varchar(255) NULL,
    filename varchar(255) NULL,
    filesize int4 NULL,
    mimetype varchar(128) NULL,
    fdata bytea NULL,
    CONSTRAINT weinried_wfs_files_pk PRIMARY KEY (fid)
);
    
CREATE OR REPLACE VIEW weinbauriede_bgl_view
AS SELECT fid,
    dataset_id,
    md_id,
    inspire_id,
    ried_id,
    subried_id,
    riedtyp,
    riedname,
    subrname,
    gemname,
    gkz,
    farbe,
    bezname,
    kgname,
    kgnr,
    flaeche_m2,
    gml_identifier,
    namespace,
    geom,
    owner
   FROM ft_weinbauriede_bgl ps
  WHERE ps.owner::text = current_setting('my.wfsuser'::text, true) OR current_setting('my.wfsuser'::text, true) = 'geoserver-admin'::text OR (EXISTS ( SELECT psfo.fid,
            psfo.username,
            psfo.owner,
            psf.fid,
            psf.objectid,
            psf.filename,
            psf.filesize,
            psf.mimetype,
            psf.fdata
           FROM weinried_wfs_file_owner psfo
             JOIN weinried_wfs_files psf ON psfo.fid = psf.fid
          WHERE psf.objectid::text = ps.gml_identifier::text AND (psfo.username::text = current_setting('my.wfsuser'::text, true) OR psfo.username::text = 'gast'::text)));


CREATE OR REPLACE VIEW weinried_wfs_files_view
AS SELECT psf.fid,
    psf.objectid,
    psf.filename,
    psf.filesize,
    psf.mimetype,
    ( SELECT string_agg(psfo2.username::text, ','::text) AS string_agg
           FROM weinried_wfs_file_owner psfo2
          WHERE psfo2.fid = psf.fid AND psfo.owner = true
          GROUP BY psfo2.fid) AS userids,
    encode(psf.fdata, 'base64'::text) AS fdata
   FROM weinried_wfs_files psf
     JOIN weinried_wfs_file_owner psfo ON psf.fid = psfo.fid
  WHERE psfo.username::text = current_setting('my.wfsuser'::text, true) OR current_setting('my.wfsuser'::text, true) = 'geoserver-admin'::text AND psfo.owner = true;
 

-- TODO: Weinried-Knoten?
CREATE OR REPLACE FUNCTION weinried_wfs_files_view_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE NewFileId INTEGER;
DECLARE uid VARCHAR;
DECLARE parentOwner VARCHAR;
BEGIN
    INSERT INTO weinried_wfs_files (objectid, filename, filesize, mimetype, fdata)
    VALUES (
        NEW.objectid,
        NEW.filename,
        NEW.filesize,
        NEW.mimetype,
        decode(NEW.fdata, 'base64')  -- Convert back to bytea
    ) 
    RETURNING "fid" INTO NewFileId;

    -- patch in the newly assigned id and get rid of fdata, as it is too large for notify (and probably neo4j too)
    --PERFORM pg_notify(('fileadd')::text, ((row_to_json(NEW)::jsonb-'fdata' || jsonb ('{"fid":' || NewFileId || '}') || jsonb('{"metadata": {"nodetype":"FT_Invekos_Schlaege_Version", "idAttr":"gml_identifier_public"}}'))::text));

    SELECT ps.owner INTO parentOwner FROM ft_weinbauriede_bgl ps WHERE ps.gml_identifier=NEW.objectid;

    FOREACH uid in array string_to_array(NEW.userids, ',')
    LOOP
        IF parentOwner <> uid THEN
            INSERT INTO weinried_wfs_file_owner VALUES (NewFileId, uid, False);
        END IF;
    END LOOP;

    INSERT INTO weinried_wfs_file_owner VALUES (NewFileId, parentOwner, True);

    IF parentOwner <> current_setting('my.wfsuser'::text, true) THEN
        INSERT INTO weinried_wfs_file_owner VALUES (NewFileId, current_setting('my.wfsuser'::text, true), True);
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


CREATE OR REPLACE FUNCTION weinried_wfs_files_view_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM weinried_wfs_files WHERE fid = OLD.fid AND (current_setting('my.wfsuser')='admin' OR EXISTS (SELECT * FROM weinried_wfs_file_owner psfo WHERE psfo.fid=OLD.fid AND psfo.username=current_setting('my.wfsuser')));
    --PERFORM pg_notify(CAST('filedel' AS text), (row_to_json(OLD)::jsonb-'fdata')::text);
    RETURN OLD;  -- Optionally return the deleted row in the view format
END;
$function$


create trigger weinried_wfs_files_view_delete_trigger instead of
delete
    on
    weinried_wfs_files_view for each row execute function weinried_wfs_files_view_delete()
    
create trigger weinried_wfs_files_view_insert_trigger instead of
insert
    on
    weinried_wfs_files_view for each row execute function weinried_wfs_files_view_insert()
    
    
INSERT INTO gt_pk_metadata (table_schema, table_name, pk_column) VALUES ('public', 'weinried_wfs_files_view', 'fid');    
