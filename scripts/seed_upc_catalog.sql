-- Siembra de los pares UPC -> SKU que hoy viven hardcodeados en
-- upcCatalogResolver.ts (KNOWN_UPC_CATALOG). Con el aprendizaje del piso
-- escribiendo en sku_metadata.upc, tener veinte pares solo en el fuente crea
-- dos fuentes de verdad para la misma llave.
--
-- Solo rellena un UPC vacio: nunca pisa uno ya guardado. Si un SKU ya tiene
-- otro UPC, esta sentencia lo deja como esta y la fila sale en la consulta de
-- control de abajo, para que una persona decida cual esta mal.

with seed(upc, sku) as (values
  ('845436088143', '03-4005-MN'),
  ('845436088099', '03-4000BL'),
  ('845436089331', '06-4638BK'),
  ('845436092959', '03-4270BK'),
  ('845436086774', '03-3868BL'),
  ('845436086781', '03-3869BL'),
  ('845436086798', '03-3870BL'),
  ('845436086804', '03-3871BL'),
  ('845436091679', '09-4807CL'),
  ('845436091594', '03-4149BR'),
  ('845436089485', '09-4796CL'),
  ('845436086545', '03-3845BL'),
  ('845436087757', '03-3970BL'),
  ('845436086583', '03-3849BK'),
  ('845436091631', '03-4153BR'),
  ('845436082769', '07-3692BL'),
  ('845436092157', '03-3919GN'),
  ('845436086644', '03-3855GY'),
  ('845436086651', '03-3858BL'),
  ('845436098432', '03-4869MN'),
  ('845438006710', '07-3743PK')
)
update sku_metadata m
   set upc = s.upc
  from seed s
 where upper(m.sku) = upper(s.sku)
   and (m.upc is null or m.upc = '');

-- Control: pares del fuente que NO quedaron sembrados y por que.
with seed(upc, sku) as (values
  ('845436088143', '03-4005-MN'),
  ('845436088099', '03-4000BL'),
  ('845436089331', '06-4638BK'),
  ('845436092959', '03-4270BK'),
  ('845436086774', '03-3868BL'),
  ('845436086781', '03-3869BL'),
  ('845436086798', '03-3870BL'),
  ('845436086804', '03-3871BL'),
  ('845436091679', '09-4807CL'),
  ('845436091594', '03-4149BR'),
  ('845436089485', '09-4796CL'),
  ('845436086545', '03-3845BL'),
  ('845436087757', '03-3970BL'),
  ('845436086583', '03-3849BK'),
  ('845436091631', '03-4153BR'),
  ('845436082769', '07-3692BL'),
  ('845436092157', '03-3919GN'),
  ('845436086644', '03-3855GY'),
  ('845436086651', '03-3858BL'),
  ('845436098432', '03-4869MN'),
  ('845438006710', '07-3743PK')
)
select s.sku,
       s.upc              as upc_del_fuente,
       m.upc              as upc_en_catalogo,
       case when m.sku is null then 'el SKU no existe en sku_metadata'
            when m.upc is null or m.upc = '' then 'sembrado por esta sentencia'
            when m.upc = s.upc then 'ya estaba, igual'
            else 'CONFLICTO: el catalogo tiene otro UPC'
       end as situacion
  from seed s
  left join sku_metadata m on upper(m.sku) = upper(s.sku)
 order by 4, 1;
