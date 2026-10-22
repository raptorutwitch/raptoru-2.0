//====================================================================
//  VOTEKICK MUTE - VARIANTE C "ALERTE REGIE"
//  Plugin : obs-shaderfilter (filtre "User-defined shader")
//  Source cible : overlay cam shushu
//
//  Cadre rouge + equerres de coin facon regie broadcast,
//  gros micro barre semi-transparent au centre, MUTED sous l'icone.
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

uniform float frame_inset<
    string label = "[C] Marge du cadre";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 0.2;
    float step = 0.002;
> = 0.030;

uniform float frame_thickness<
    string label = "[C] Epaisseur du cadre";
    string widget_type = "slider";
    float minimum = 0.002;
    float maximum = 0.05;
    float step = 0.001;
> = 0.010;

uniform float bracket_length<
    string label = "[C] Longueur des equerres";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 0.4;
    float step = 0.005;
> = 0.13;

uniform float icon_scale<
    string label = "[C] Taille du micro";
    string widget_type = "slider";
    float minimum = 0.05;
    float maximum = 0.5;
    float step = 0.005;
> = 0.17;

uniform float icon_opacity<
    string label = "[C] Opacite du micro";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.01;
> = 0.80;

uniform float icon_pos_y<
    string label = "[C] Position Y du micro";
    string widget_type = "slider";
    float minimum = -0.5;
    float maximum = 0.5;
    float step = 0.005;
> = 0.07;

uniform float text_scale<
    string label = "[C] Taille du texte";
    string widget_type = "slider";
    float minimum = 0.01;
    float maximum = 0.15;
    float step = 0.002;
> = 0.048;

uniform float text_pos_y<
    string label = "[C] Position Y du texte";
    string widget_type = "slider";
    float minimum = -0.5;
    float maximum = 0.5;
    float step = 0.005;
> = -0.20;

uniform float scrim_amount<
    string label = "[C] Voile sombre derriere l'icone";
    string widget_type = "slider";
    float minimum = 0.0;
    float maximum = 1.0;
    float step = 0.01;
> = 0.35;

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

    //---------------------------------------------- repere centre, Y vers le haut, zoom anime
    float2 c  = float2((uv.x - 0.5) * aspect, 0.5 - uv.y) / animScale;
    float  px = max(uv_pixel_interval.y / animScale, 0.0004);
    float  aa = px * 1.3;

    float hx = max(0.5 * aspect - frame_inset, 0.02);
    float hy = max(0.5 - frame_inset, 0.02);
    float rad = min(0.045, min(hx, hy) * 0.5);

    float dFrame = sdBox(c, float2(hx - rad, hy - rad)) - rad;

    // cadre fin continu
    float aRing = fillSDF(abs(dFrame) - frame_thickness * 0.5, aa);

    // equerres de coin, plus epaisses
    float L = bracket_length;
    float mx = smoothstep(hx - L - aa, hx - L + aa, abs(c.x));
    float my = smoothstep(hy - L - aa, hy - L + aa, abs(c.y));
    float aBracket = fillSDF(abs(dFrame) - frame_thickness * 1.7, aa) * mx * my;

    //---------------------------------------------- voile + icone + texte
    float2 grp = c - float2(0.0, (icon_pos_y + text_pos_y) * 0.5);
    float dScrim = length(grp / float2(0.46, 0.34)) - 1.0;
    float aScrim = saturate(-dScrim * 1.6) * scrim_amount;

    float ms = max(icon_scale, 0.01);
    float2 mic = micSDF((c - float2(0.0, icon_pos_y)) / ms);
    float aMic   = fillSDF(mic.x * ms, aa) * icon_opacity;
    float aSlash = fillSDF(mic.y * ms, aa) * saturate(icon_opacity + 0.15);

    float ts = max(text_scale, 0.005);
    float aText = fillSDF(textMuted((c - float2(0.0, text_pos_y)) / ts, 0.115) * ts, aa);

    //---------------------------------------------- composition
    float3 bc = float3(0.03, 0.008, 0.014);
    float  ba = aScrim;

    float3 cEdge = float3(0.98, 0.16, 0.19);
    float  ringA = aRing * (0.55 + 0.45 * pulse);
    bc = lerp(bc, cEdge, ringA);
    ba = max(ba, ringA);

    float brA = aBracket * (0.75 + 0.25 * pulse);
    bc = lerp(bc, float3(1.0, 0.30, 0.32), brA);
    ba = max(ba, brA);

    bc = lerp(bc, float3(1.0, 0.97, 0.97), aMic);
    ba = max(ba, aMic);

    float slA = aSlash * (0.88 + 0.12 * pulse);
    bc = lerp(bc, float3(1.0, 0.17, 0.20), slA);
    ba = max(ba, slA);

    bc = lerp(bc, float3(1.0, 0.94, 0.94), aText);
    ba = max(ba, aText);

    float3 outRGB = lerp(col, bc, ba);
    float  outA   = max(src.a, ba);

    return lerp(src, float4(outRGB, outA), saturate(fx_opacity) * env);
}
