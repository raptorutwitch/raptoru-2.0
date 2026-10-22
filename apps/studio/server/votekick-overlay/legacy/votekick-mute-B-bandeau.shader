//====================================================================
//  VOTEKICK MUTE - VARIANTE B "BANDEAU CENSURE"
//  Plugin : obs-shaderfilter (filtre "User-defined shader")
//  Source cible : overlay cam shushu
//
//  Bandeau diagonal type ruban de censure, motif hachure anime,
//  groupes "micro barre + MUTED" repetes et defilants.
//  Horloge : elapsed_time_enable (remis a 0 a chaque activation).
//  SAMMI ecrit mute_duration puis active/desactive le filtre.
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
> = 1.2;

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

uniform float band_pos_y<
    string label = "[B] Position Y du bandeau";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.005;
> = 0.5;

uniform float band_scale<
    string label = "[B] Epaisseur du bandeau";
    string widget_type = "slider";
    float minimum = 0.3;
    float maximum = 3.0;
    float step = 0.01;
> = 1.0;

uniform float band_angle<
    string label = "[B] Angle du bandeau (deg)";
    string widget_type = "slider";
    float minimum = -45.0;
    float maximum = 45.0;
    float step = 0.5;
> = -14.0;

uniform float band_opacity<
    string label = "[B] Opacite du bandeau";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.01;
> = 1.0;

uniform float stripe_speed<
    string label = "[B] Defilement des hachures";
    string widget_type = "slider";
    float minimum = -2.0;
    float maximum = 2.0;
    float step = 0.01;
> = 0.35;

uniform float scroll_speed<
    string label = "[B] Defilement du texte";
    string widget_type = "slider";
    float minimum = -3.0;
    float maximum = 3.0;
    float step = 0.01;
> = 0.55;

//--------------------------------------------------------------------
//  Helpers
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
//  Glyphes (demi-hauteur 0.45, demi-largeur ~0.28, Y vers le haut)
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

// "MUTED" centre sur l'origine
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

// Icone micro barre. Repere local : demi-hauteur ~1, Y vers le haut.
// Renvoie x = corps du micro (troue autour de la barre), y = barre.
float2 micSDF(float2 mp)
{
    float dBody = sdBox(mp - float2(0.0, 0.38), float2(0.0, 0.16)) - 0.30;
    float dArc  = abs(length(mp - float2(0.0, 0.30)) - 0.62) - 0.085;
    dArc = max(dArc, mp.y - 0.30);
    dBody = min(dBody, dArc);
    dBody = min(dBody, sdBox(mp - float2(0.0, -0.62), float2(0.075, 0.22)));
    dBody = min(dBody, sdBox(mp - float2(0.0, -0.86), float2(0.36, 0.075)));

    float dLine  = sdSeg(mp, float2(-0.88, 0.92), float2(0.88, -0.92));
    float dSlash = dLine - 0.105;
    dBody = max(dBody, -(dLine - 0.23));

    return float2(dBody, dSlash);
}

//--------------------------------------------------------------------
//  Rendu
//--------------------------------------------------------------------

float4 mainImage(VertData v_in) : TARGET
{
    float4 src = image.Sample(textureSampler, v_in.uv);
    float2 uv  = v_in.uv;

    // elapsed_time_enable : remis a 0 a chaque activation du filtre
    float  t = elapsed_time_enable;
    float  aspect = uv_size.x / max(uv_size.y, 1.0);
    float  pulse = 0.5 + 0.5 * sin(t * pulse_speed * 6.28318530718);

    //---------------------------------------------- enveloppe apparition / disparition
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

    float animScale = max(scaleIn * scaleOut, 0.05);
    float env = saturate(alphaIn * alphaOut);

    //---------------------------------------------- teinte / vignettage / scanlines
    float3 col = src.rgb;
    col = lerp(col, col * tint_color.rgb, saturate(tint_amount) * (0.85 + 0.15 * pulse));

    float r = length((uv - 0.5) * 2.0);
    col *= 1.0 - vignette_amount * 0.85 * smoothstep(0.55, 1.35, r);
    col += tint_color.rgb * vignette_amount * 0.30 * smoothstep(0.70, 1.45, r) * (0.55 + 0.45 * pulse);

    float sl = 0.5 + 0.5 * sin(uv.y * uv_size.y * 2.0943951 - t * 5.0);
    col *= 1.0 - scanline_amount * sl;

    //---------------------------------------------- bandeau
    float ang = radians(band_angle);
    float ca = cos(ang);
    float sa = sin(ang);

    float2 cc = float2((uv.x - 0.5) * aspect, band_pos_y - uv.y);
    float2 rc = float2(cc.x * ca - cc.y * sa, cc.x * sa + cc.y * ca);

    float bh = 0.105 * max(band_scale, 0.01) * animScale;   // demi-epaisseur animee
    float2 q = rc / bh;
    float px = max(uv_pixel_interval.y / bh, 0.0004);
    float aa = px * 1.3;

    float aBand = fillSDF(abs(q.y) - 1.0, aa);
    float aEdge = fillSDF(abs(abs(q.y) - 1.0) - 0.085, aa);

    // hachures diagonales animees
    float stripe = frac((q.x + q.y * 1.7) * 0.42 - t * stripe_speed);
    float hatch = smoothstep(0.48, 0.52, stripe);
    float3 bandCol = lerp(float3(0.085, 0.010, 0.018), float3(0.30, 0.022, 0.038), hatch);

    // groupes "micro + MUTED" repetes et defilants
    float period = 7.6;
    float qx = q.x + t * scroll_speed;
    qx = qx - period * floor(qx / period + 0.5);
    float2 tq = float2(qx, q.y);

    float2 mic = micSDF((tq - float2(-2.0, 0.0)) / 0.78);
    float aMic   = fillSDF(mic.x * 0.78, aa) * aBand;
    float aSlash = fillSDF(mic.y * 0.78, aa) * aBand;
    float aText  = fillSDF(textMuted(tq - float2(1.2, 0.0), 0.115), aa) * aBand;

    //---------------------------------------------- composition
    float3 bc = bandCol;
    float  ba = aBand * 0.94;

    float3 cEdge = float3(0.98, 0.16, 0.19);
    float  eA = aEdge * (0.75 + 0.25 * pulse);
    bc = lerp(bc, cEdge, eA);
    ba = max(ba, eA);

    bc = lerp(bc, float3(1.0, 0.97, 0.97), aMic);
    ba = max(ba, aMic);

    float slA = aSlash * (0.88 + 0.12 * pulse);
    bc = lerp(bc, float3(1.0, 0.17, 0.20), slA);
    ba = max(ba, slA);

    bc = lerp(bc, float3(1.0, 0.94, 0.94), aText);
    ba = max(ba, aText);

    ba *= saturate(band_opacity);

    float3 outRGB = lerp(col, bc, ba);
    float  outA   = max(src.a, ba);

    return lerp(src, float4(outRGB, outA), saturate(fx_opacity) * env);
}
