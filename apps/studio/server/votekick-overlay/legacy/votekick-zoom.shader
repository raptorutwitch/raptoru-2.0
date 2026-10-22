//====================================================================
//  VOTEKICK ZOOM - zoom audio-reactif
//  Plugin : obs-shaderfilter (filtre "User-defined shader")
//  Source cible : overlay cam shushu
//
//  Ce shader ne lit AUCUN audio. Il expose un seul uniform "zoom"
//  qu'un filtre Audio Move (plugin Move, Exeldro) vient ecrire.
//
//  Securite : zoom est clampe entre 1.0 et zoom_max dans le shader.
//  Meme si Audio Move envoie une valeur aberrante, l'image ne peut
//  ni retrecir sous 100 % ni depasser zoom_max.
//
//  Le transform OBS de la source n'est jamais modifie : desactiver
//  le filtre rend l'image d'origine, au pixel pres.
//====================================================================

uniform float zoom<
    string label = "Zoom (ecrit par Audio Move)";
    string widget_type = "slider";
    float minimum = 1.0;
    float maximum = 1.30;
    float step = 0.001;
> = 1.0;

uniform float zoom_max<
    string label = "Zoom maximum autorise";
    string widget_type = "slider";
    float minimum = 1.0;
    float maximum = 1.30;
    float step = 0.001;
> = 1.08;

uniform float zoom_center_x<
    string label = "Centre du zoom X";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.005;
> = 0.5;

uniform float zoom_center_y<
    string label = "Centre du zoom Y";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.005;
> = 0.5;

float4 mainImage(VertData v_in) : TARGET
{
    float z = clamp(zoom, 1.0, max(zoom_max, 1.0));

    float2 c = float2(zoom_center_x, zoom_center_y);
    float2 uv = (v_in.uv - c) / z + c;

    // z >= 1 donc uv reste dans [0,1], le clamp est une simple ceinture
    uv = clamp(uv, 0.0, 1.0);

    return image.Sample(textureSampler, uv);
}
