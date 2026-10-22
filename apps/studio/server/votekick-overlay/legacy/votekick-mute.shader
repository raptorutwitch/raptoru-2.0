//====================================================================
//  VOTEKICK MUTE  -  FX camera
//  Plugin : obs-shaderfilter (filtre "User-defined shader" / "Shader")
//  Source cible : overlay cam shushu
//
//  Le shader ne gere AUCUN timer. Il reste visible tant que le filtre
//  est actif. SAMMI pilote uniquement "Filter Change Visibility".
//  Tout est calcule en unites relatives a la hauteur de la source :
//  le rendu est identique quelle que soit la resolution de la cam.
//====================================================================

uniform float fx_opacity<
    string label = "Opacite globale de l'effet";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.01;
> = 1.0;

uniform float4 tint_color<
    string label = "Couleur de teinte";
    string widget_type = "color";
> = {0.85, 0.10, 0.12, 1.0};

uniform float tint_amount<
    string label = "Force de la teinte";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.01;
> = 0.30;

uniform float vignette_amount<
    string label = "Vignettage rouge";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.01;
> = 0.45;

uniform float scanline_amount<
    string label = "Scanlines";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 0.4;
    float step = 0.01;
> = 0.07;

uniform float pulse_speed<
    string label = "Vitesse du pulse (Hz)";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 3.0;
    float step = 0.05;
> = 0.8;

uniform float badge_scale<
    string label = "Taille du badge";
    string widget_type = "slider";
    float minimum = 0.3;
    float maximum = 3.0;
    float step = 0.01;
> = 1.0;

uniform float badge_pos_x<
    string label = "Position X du badge";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.005;
> = 0.5;

uniform float badge_pos_y<
    string label = "Position Y du badge";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.005;
> = 0.82;

uniform float badge_opacity<
    string label = "Opacite du badge";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.01;
> = 1.0;

uniform float shake_amount<
    string label = "Vibration du badge";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 2.0;
    float step = 0.01;
> = 0.35;

uniform bool badge_over_transparent<
    string label = "Badge visible sur les zones transparentes";
> = true;

uniform float mute_duration<
    string label = "Duree du mute (s, 0 = illimite)";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 300.0;
    float step = 0.5;
> = 0.0;

uniform float anim_in_time<
    string label = "Duree de l'apparition (s)";
    string widget_type = "slider";
    float minimum = 0.05;
    float maximum = 2.0;
    float step = 0.01;
> = 0.55;

uniform float anim_out_time<
    string label = "Duree de la disparition (s)";
    string widget_type = "slider";
    float minimum = 0.05;
    float maximum = 2.0;
    float step = 0.01;
> = 0.45;

uniform float bounce_amount<
    string label = "Rebond du pop";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 2.5;
    float step = 0.05;
> = 0.9;

uniform float manual_time<
    string label = "Temps manuel (-1 = horloge du shader)";
    string widget_type = "slider";
    float minimum = -1.0;
    float maximum = 300.0;
    float step = 0.01;
> = -1.0;   // -1 = auto. Sert uniquement au debug/reglage.

//--------------------------------------------------------------------
//  Helpers SDF
//--------------------------------------------------------------------

float easeOutBack(float x, float k)
{
    float c1 = 1.70158 * max(k, 0.0);
    float c3 = c1 + 1.0;
    float f = x - 1.0;
    return 1.0 + c3 * f * f * f + c1 * f * f;
}

float sdBox(float2 p, float2 b)
{
    float2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSeg(float2 p, float2 a, float2 b)
{
    float2 pa = p - a;
    float2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
}

float fillSDF(float d, float aa)
{
    return saturate(0.5 - d / max(aa, 1e-6));
}

//--------------------------------------------------------------------
//  Glyphes  (demi-hauteur 0.45, demi-largeur ~0.28)
//--------------------------------------------------------------------

float glyphM(float2 p, float th)
{
    float d = sdBox(p - float2(-0.24, 0.0), float2(th * 0.5, 0.45));
    d = min(d, sdBox(p - float2(0.24, 0.0), float2(th * 0.5, 0.45)));
    d = min(d, sdSeg(p, float2(-0.24, 0.42), float2(0.0, 0.02)) - th * 0.5);
    d = min(d, sdSeg(p, float2(0.24, 0.42), float2(0.0, 0.02)) - th * 0.5);
    return d;
}

float glyphU(float2 p, float th)
{
    float d = sdBox(p - float2(-0.22, 0.08), float2(th * 0.5, 0.37));
    d = min(d, sdBox(p - float2(0.22, 0.08), float2(th * 0.5, 0.37)));
    d = min(d, sdBox(p - float2(0.0, -0.40), float2(0.22, th * 0.5)));
    return d;
}

float glyphT(float2 p, float th)
{
    float d = sdBox(p - float2(0.0, 0.40), float2(0.28, th * 0.5));
    d = min(d, sdBox(p, float2(th * 0.5, 0.45)));
    return d;
}

float glyphE(float2 p, float th)
{
    float d = sdBox(p - float2(-0.24, 0.0), float2(th * 0.5, 0.45));
    d = min(d, sdBox(p - float2(-0.02, 0.40), float2(0.26, th * 0.5)));
    d = min(d, sdBox(p - float2(-0.05, 0.0), float2(0.23, th * 0.5)));
    d = min(d, sdBox(p - float2(-0.02, -0.40), float2(0.26, th * 0.5)));
    return d;
}

float glyphD(float2 p, float th)
{
    float d = sdBox(p - float2(-0.24, 0.0), float2(th * 0.5, 0.45));
    d = min(d, sdBox(p - float2(-0.07, 0.40), float2(0.19, th * 0.5)));
    d = min(d, sdBox(p - float2(-0.07, -0.40), float2(0.19, th * 0.5)));
    d = min(d, sdBox(p - float2(0.21, 0.0), float2(th * 0.5, 0.30)));
    d = min(d, sdSeg(p, float2(0.12, 0.40), float2(0.21, 0.30)) - th * 0.5);
    d = min(d, sdSeg(p, float2(0.12, -0.40), float2(0.21, -0.30)) - th * 0.5);
    return d;
}

// "MUTED", centre sur l'origine
float textMuted(float2 p, float th)
{
    float adv = 0.72;
    float d = glyphM(p - float2(-2.0 * adv, 0.0), th);
    d = min(d, glyphU(p - float2(-1.0 * adv, 0.0), th));
    d = min(d, glyphT(p, th));
    d = min(d, glyphE(p - float2(1.0 * adv, 0.0), th));
    d = min(d, glyphD(p - float2(2.0 * adv, 0.0), th));
    return d;
}

//--------------------------------------------------------------------
//  Rendu
//--------------------------------------------------------------------

float4 mainImage(VertData v_in) : TARGET
{
    float4 src = image.Sample(textureSampler, v_in.uv);
    float2 uv  = v_in.uv;
    // elapsed_time_enable : remis a 0 a chaque activation du filtre
    // (contrairement a elapsed_time qui tourne en continu)
    float  t   = elapsed_time_enable;

    float aspect = uv_size.x / max(uv_size.y, 1.0);

    // pulse doux 0..1
    float pulse = 0.5 + 0.5 * sin(t * pulse_speed * 6.28318530718);

    //---------------------------------------------- enveloppe apparition / disparition
    // T = temps ecoule depuis l'activation du filtre (elapsed_time_enable).
    // manual_time reste dispo comme override de debug : mets une valeur >= 0
    // pour figer l'animation a un instant precis et regler les courbes.
    float T = (manual_time >= 0.0) ? manual_time : t;

    float tin = saturate(T / max(anim_in_time, 0.001));
    float scaleIn = 0.30 + 0.70 * easeOutBack(tin, bounce_amount);
    float alphaIn = smoothstep(0.0, 0.30, tin);

    float scaleOut = 1.0;
    float alphaOut = 1.0;
    if (mute_duration > 0.001)
    {
        float tout = saturate((T - (mute_duration - anim_out_time)) / max(anim_out_time, 0.001));
        float e = tout * tout * (3.0 - 2.0 * tout);
        scaleOut = lerp(1.0, 0.72, e);
        alphaOut = 1.0 - e;
    }

    float badgeAnimScale = max(scaleIn * scaleOut, 0.05);
    float env = saturate(alphaIn * alphaOut);

    //---------------------------------------------- teinte
    float3 col = src.rgb;
    float3 warm = col * tint_color.rgb;
    col = lerp(col, warm, saturate(tint_amount) * (0.85 + 0.15 * pulse));

    //---------------------------------------------- vignettage + halo rouge
    float2 vc = (uv - 0.5) * 2.0;
    float  r  = length(vc);
    float  vig = smoothstep(0.55, 1.35, r);
    col *= 1.0 - vignette_amount * 0.85 * vig;
    col += tint_color.rgb * vignette_amount * 0.30 * smoothstep(0.70, 1.45, r) * (0.55 + 0.45 * pulse);

    //---------------------------------------------- scanlines
    float sl = 0.5 + 0.5 * sin(uv.y * uv_size.y * 2.0943951 - t * 5.0);
    col *= 1.0 - scanline_amount * sl;

    //---------------------------------------------- badge
    float  s  = 0.085 * max(badge_scale, 0.01) * badgeAnimScale;   // demi-hauteur animee
    // ATTENTION : dans obs-shaderfilter l'origine UV est en HAUT a gauche et
    // uv.y augmente vers le BAS. On inverse donc Y ici pour que tout le repere
    // local du badge (icone + glyphes) soit Y vers le haut.
    float2 q  = float2((uv.x - badge_pos_x) * aspect, badge_pos_y - uv.y) / s;
    float  px = max(uv_pixel_interval.y / s, 0.0004);
    float  aa = px * 1.3;

    float2 sh = float2(sin(t * 23.0) + 0.6 * sin(t * 41.0),
                       cos(t * 19.0) + 0.6 * cos(t * 37.0)) * 0.055 * shake_amount;
    q -= sh;

    // pilule
    float dPill = sdBox(q, float2(2.30, 0.0)) - 1.0;
    float aPill = fillSDF(dPill, aa) * 0.66;
    float aEdge = fillSDF(abs(dPill + 0.055) - 0.055, aa);

    // icone micro barre
    float2 mp = (q - float2(-2.25, 0.0)) / 0.78;
    float dBody = sdBox(mp - float2(0.0, 0.38), float2(0.0, 0.16)) - 0.30;   // capsule
    float dArc  = abs(length(mp - float2(0.0, 0.30)) - 0.62) - 0.085;        // berceau
    dArc = max(dArc, mp.y - 0.30);
    dBody = min(dBody, dArc);
    dBody = min(dBody, sdBox(mp - float2(0.0, -0.62), float2(0.075, 0.22))); // pied
    dBody = min(dBody, sdBox(mp - float2(0.0, -0.86), float2(0.36, 0.075))); // socle

    float dSlashLine = sdSeg(mp, float2(-0.88, 0.92), float2(0.88, -0.92));
    float dSlash = dSlashLine - 0.105;
    dBody = max(dBody, -(dSlashLine - 0.23));                                // gouttiere autour de la barre

    float aMic   = fillSDF(dBody * 0.78, aa);
    float aSlash = fillSDF(dSlash * 0.78, aa);

    // texte MUTED
    float dText = textMuted(q - float2(0.95, 0.0), 0.115);
    float aText = fillSDF(dText, aa);

    // composition du badge
    float3 bc = float3(0.055, 0.020, 0.030);
    float  ba = aPill;

    float3 cEdge = float3(0.98, 0.16, 0.19);
    float  eA = aEdge * (0.75 + 0.25 * pulse);
    bc = lerp(bc, cEdge, eA);
    ba = max(ba, eA * 0.95);

    bc = lerp(bc, float3(1.0, 0.97, 0.97), aMic);
    ba = max(ba, aMic);

    float slA = aSlash * (0.88 + 0.12 * pulse);
    bc = lerp(bc, float3(1.0, 0.17, 0.20), slA);
    ba = max(ba, slA);

    bc = lerp(bc, float3(1.0, 0.94, 0.94), aText);
    ba = max(ba, aText);

    // halo rouge autour de la pilule
    float glow = exp(-max(dPill, 0.0) * 2.6) * 0.22 * (0.55 + 0.45 * pulse);
    bc = lerp(bc, cEdge, saturate(glow * (1.0 - ba)));
    ba = saturate(ba + glow * (1.0 - ba));

    ba *= saturate(badge_opacity);
    if (!badge_over_transparent)
        ba *= src.a;

    //---------------------------------------------- sortie
    float3 outRGB = lerp(col, bc, ba);
    float  outA   = max(src.a, ba);

    return lerp(src, float4(outRGB, outA), saturate(fx_opacity) * env);
}
