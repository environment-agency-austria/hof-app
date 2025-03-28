-- ID-Handling, ändert sich die Geometrie eines Schlages (+ ev weitere Attribute) nicht, so behält er seine ID.

-- 0. Primary Key: localId + jahr
alter table invekos_schlaege_2015_2024 add localIdNew VARCHAR(64);
alter table invekos_schlaege_2015_2024 add firstfoederart VARCHAR(64);

-- 1. Schritt, jeder Schlag bekommt eine UUID (aktuell wird localId einfach wiederverwendet)
UPDATE invekos_schlaege_2015_2024 set localIdNew = gen_random_uuid();

-- 2. Hilfstabelle mit allen Schlägen, die eine ältere "Entsprechung" haben.
-- Enthält zu jedem Schlag sein ältestes Pedant mit ähnlicher Geometrie
create table newlocalids as (
with full_relationships as (select * from schlaege_relationships rs where rs.percent_previous > 99 and rs.percent_current > 99),                                                    -- alle entsprechungen mit >99%
min_schlag_entspricht as (select r.fid_current, r.year_current, MIN(r.year_previous) as year_previous  from full_relationships r  group by r.fid_current, r.year_current),          -- die erste/aelteste Entsprechung mit >99%
full_localids as (select sp.localIdNew as spid, sp.fid as spfid, rp.year_previous, sc.localIdNew as scid, sc.fid as scfid, rp.year_current, rp.percent_previous, rp.percent_current   -- wie full_relationships, + localId
    from full_relationships rp
    join invekos_schlaege_2015_2024 sp on (sp.foerderart = 'MFA' || rp.year_previous and sp.fid = rp.fid_previous) 
    join invekos_schlaege_2015_2024 sc on (sc.foerderart = 'MFA' || rp.year_current and sc.fid = rp.fid_current))
select m.fid_current as fid_current, 'MFA'||m.year_current as foerderart_current, f.spid, 'MFA'||m.year_previous as foerderart_previous FROM min_schlag_entspricht m left join full_localids f on (m.year_current = f.year_current and m.year_previous = f.year_previous and m.fid_current=f.scfid)
);
create index newlocalids_pk on newlocalids(fid_current, foerderart_current);

-- 3. Inhalt der Hilfstabelle auf die Schläge übertragen.
-- Existiert für einen Schlag eine ältere Version, dessen Geometrie übereinstimmt, so übernimmt der aktuelle Schlag dessen ID.
-- Gibt es keine Übereinstimmung, so behält der Schlag seine eindeutige localId
UPDATE invekos_schlaege_2015_2024 set localIdNew=m.spid, firstfoederart=m.foerderart_previous  FROM newlocalids m where (invekos_schlaege_2015_2024.fid=m.fid_current and invekos_schlaege_2015_2024.foerderart=m.foerderart_current);


drop table newlocalids;
