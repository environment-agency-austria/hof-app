CREATE TABLE IF NOT EXISTS schlaege_relationships (
    fid_current INTEGER NOT NULL,
    fid_previous INTEGER NOT NULL,
    year_current INTEGER NOT NULL,
    year_previous INTEGER NOT NULL,
    percent_current NUMERIC NOT NULL,
    percent_previous NUMERIC NOT NULL,
    PRIMARY KEY (fid_current, fid_previous)
);

-- NEU:
INSERT INTO schlaege_relationships (fid_current, fid_previous, year_current, year_previous, percent_current, percent_previous)
SELECT
    current_year.fid AS fid_current,
    previous_year.fid AS fid_previous,
    CAST(RIGHT(current_year.foerderart, 4) AS INTEGER) AS year_current,
    CAST(RIGHT(previous_year.foerderart, 4) AS INTEGER) AS year_previous,
    (ST_Area(ST_Intersection(current_year.geom, previous_year.geom)) / NULLIF(ST_Area(current_year.geom), 0)) * 100 AS percent_current,
    (ST_Area(ST_Intersection(current_year.geom, previous_year.geom)) / NULLIF(ST_Area(previous_year.geom), 0)) * 100 AS percent_previous
FROM invekos_schlaege_2015_2024 current_year
JOIN invekos_schlaege_2015_2024 previous_year
    ON ST_Intersects(current_year.geom, previous_year.geom)
-- Exclude parcels that already matched based on schlag_id
--LEFT JOIN schlaege_relationships existing_rel
--   ON current_year.fid = existing_rel.fid_current
--    AND previous_year.fid = existing_rel.fid_previous
WHERE CAST(RIGHT(current_year.foerderart, 4) AS INTEGER) > CAST(RIGHT(previous_year.foerderart, 4) AS INTEGER)
and (
(ST_Area(ST_Intersection(current_year.geom, previous_year.geom)) / NULLIF(ST_Area(current_year.geom), 0)) > 0.01
OR
(ST_Area(ST_Intersection(current_year.geom, previous_year.geom)) / NULLIF(ST_Area(previous_year.geom), 0)) > 0.01
);


-----------------    Neo4J    -----------------------------


-- 1. Beziehung für perfekte Übereinstimmung, wird aktuell nicht importiert
--      speichern als TXT (CSV-Format wird schon durch Select generiert)
select 'schlagid_previous, year_previous, schlagid_current, year_current' as csv
union ALL
select 
(select sp.schlag_id || ',MFA' || MIN(r.year_previous) || ',' || sc.schlag_id || ',MFA' || r.year_current
    from schlaege_relationships rp 
    join invekos_schlaege_2015_2024 sp on (sp.foerderart = 'MFA' || rp.year_previous and sp.fid = rp.fid_previous) 
    join invekos_schlaege_2015_2024 sc on (sc.foerderart = 'MFA' || rp.year_current and sc.fid = rp.fid_current) 
    where rp.fid_current=r.fid_current and rp.year_current = r.year_current and rp.year_previous=MIN(r.year_previous) order by rp.percent_current desc limit 1)
from schlaege_relationships r 
    where r.percent_previous > 99 and r.percent_current > 99 group by r.fid_current, r.year_current;


// Alle entspricht-relationen löschen
:auto CALL {
 MATCH (p)-[r:entspricht]-(c)
 DELETE r
} IN TRANSACTIONS OF 100000 ROWS;


:auto LOAD CSV FROM '..../entspricht.csv' AS line
CALL {
 WITH line
 MATCH (p:FT_Invekos_Schlaege_Version {schlag_id : line[0], foerderart : line[1]}), (c:FT_Invekos_Schlaege_Version {schlag_id : line[2], foerderart : line[3]})
 CREATE (p)-[:entspricht]->(c)
} IN TRANSACTIONS OF 100000 ROWS;
 
 
   
-- 2. "entstanden aus", Beziehung immer nur von Jahr zu Jahr (Ausnahme 2021->2023), Überdeckungen ab 5% werden berücksichtigt
--      speichern als CSV
select 
        sp.schlag_id as schlagid_previous, 'MFA' || rp.year_previous as year_previous, sc.schlag_id as schlagid_current, 'MFA' || rp.year_current as year_current, rp.percent_current, rp.percent_previous
    from schlaege_relationships rp 
    join invekos_schlaege_2015_2024 sp on (sp.foerderart = 'MFA' || rp.year_previous and sp.fid = rp.fid_previous) 
    join invekos_schlaege_2015_2024 sc on (sc.foerderart = 'MFA' || rp.year_current and sc.fid = rp.fid_current)
    where (rp.year_current = rp.year_previous+1 or (rp.year_previous=2021 and rp.year_current=2023)) and rp.percent_current > 5;

:auto CALL {
 MATCH (p)-[r:entstanden_aus]-(c)
 DELETE r
} IN TRANSACTIONS OF 100000 ROWS;

:auto LOAD CSV FROM 'http://93.83.133.214/beziehungen.csv' AS line
CALL {
 WITH line
 MATCH (p:FT_Invekos_Schlaege_Version {schlag_id : line[0], foerderart : line[1]}), (c:FT_Invekos_Schlaege_Version {schlag_id : line[2], foerderart : line[3]})
 CREATE (p)-[:entstanden_aus{prozent_alt : toFloat(line[5]), prozent_neu : toFloat(line[4])}]->(c)
} IN TRANSACTIONS OF 100000 ROWS;
