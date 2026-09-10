-- backup of media_items.config_json for kind='scene' at 20260910_132805
-- restore: run each UPDATE against the neon imgvault DB
-- (revert: psql or Neon HTTP /sql with Neon-Connection-String)

-- anime-train-500k (nested)
UPDATE media_items SET config_json = '{"camera":{"position":[0,0,4.5],"quaternion":[1,0,0,0],"fov_y_deg":90},"scene":{"position":[0,0,10],"rotation":[3.141592653589793,0,0],"offset":[0,0,-2]},"controls":{"camera_radius":4.5,"orbit_radius":400}}' WHERE id = 'b6b3fd6a-1a94-4d52-a1ca-2017d0040b0e';

-- 31b40b75-fa05-403c-9bef-def66948e218_ceramic (flat)
UPDATE media_items SET config_json = '{"position":[0.0074808597564697266,-0.7776682376861572,13.183479690551758],"rotation":[3.141592653589793,0,0],"offset":[0,0,0],"cameraRadius":13.2,"radius":null,"duration":null}' WHERE id = 'd1394dbd-5c75-4260-ba13-a2b8ca9f81fb';

-- amphitheater-500k (nested)
UPDATE media_items SET config_json = '{"camera":{"position":[0,0,8],"quaternion":[1,0,0,0],"fov_y_deg":90},"scene":{"position":[0,-2,10],"rotation":[3.141592653589793,0,0],"offset":[0,0,-2]},"controls":{"camera_radius":8,"orbit_radius":400}}' WHERE id = 'e5271f0a-55a5-4be4-89e1-08342ce47067';

-- garden-500k (nested)
UPDATE media_items SET config_json = '{"camera":{"position":[0,0,3],"quaternion":[1,0,0,0],"fov_y_deg":90},"scene":{"position":[0,0,6],"rotation":[3.141592653589793,0,0],"offset":[0,0,-2]},"controls":{"camera_radius":3,"orbit_radius":250,"duration":5}}' WHERE id = '537c5a09-bcd6-42f1-92b2-c6df53946385';

-- autumn-500k (nested)
UPDATE media_items SET config_json = '{"camera":{"position":[0,0,3.5],"quaternion":[1,0,0,0],"fov_y_deg":90},"scene":{"position":[0.5,0.5,1],"rotation":[3.141592653589793,0,0],"offset":[0,0,-1]},"controls":{"camera_radius":3.5,"orbit_radius":350,"duration":5}}' WHERE id = '08ce636b-74da-4563-8584-f185cf11d000';

-- bath-500k (nested)
UPDATE media_items SET config_json = '{"camera":{"position":[0,0,5],"quaternion":[1,0,0,0],"fov_y_deg":90},"scene":{"position":[0,0,7],"rotation":[3.141592653589793,0,0],"offset":[0,0,-1.5]},"controls":{"orbit_radius":100,"duration":5.5}}' WHERE id = '4e58d85a-52e7-4f52-ba79-6b57009f0d38';

-- town-500k (nested)
UPDATE media_items SET config_json = '{"camera":{"position":[0,0,2.5],"quaternion":[1,0,0,0],"fov_y_deg":90},"scene":{"position":[-1,1,8],"rotation":[3.141592653589793,0,0],"offset":[0,0,-0.5]},"controls":{"camera_radius":2.5,"orbit_radius":1200,"duration":4}}' WHERE id = '7dd9add2-b9a0-47a9-adab-559cac11514d';
